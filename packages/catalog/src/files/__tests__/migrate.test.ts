import {
  beforeFolders,
  FOLDERS,
  libraryIds,
  MIGRATION_TESTS_TIMEOUT_MS,
  MIGRATIONS,
  pages,
  writeBeforeFolders,
} from '#__tests__/before-folders';
import { catalogDatabase } from '#data/database';
import { known } from '#data/items';
import { scopeOrder } from '#data/scope-orders';
import { migrateIndex, NewerIndexError } from '#files/migrate';
import { connectIndex, prepareIndex } from '#files/photo-index';
import { once } from 'node:events';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Worker } from 'node:worker_threads';
import { expect, onTestFinished, test, vi } from 'vitest';

vi.setConfig({ testTimeout: MIGRATION_TESTS_TIMEOUT_MS });

/** The migrations from the folders' migration on, which an index before it then applies. */
const SINCE_FOLDERS = MIGRATIONS.map(({ name }) => name).filter((name) => name >= FOLDERS);

async function indexFile() {
  const directory = await mkdtemp(path.join(tmpdir(), 'index-migrations-'));
  onTestFinished(() => rm(directory, { force: true, recursive: true }));
  return path.join(directory, 'photo-index.db');
}

function migrationsOf(database: DatabaseSync) {
  const rows = database.prepare('SELECT name FROM __drizzle_migrations ORDER BY id').all();
  return rows.map((row) => String(row.name));
}

test('a new index has every migration, and opening it again applies none', async () => {
  const file = await indexFile();
  const first = connectIndex(file);
  const applied = migrationsOf(first);
  expect(applied.length).toBeGreaterThan(0);
  expect(applied.at(-1)).toMatch(/^\d{14}_/u);
  first.close();
  const again = connectIndex(file);
  onTestFinished(() => again.close());
  expect(migrationsOf(again)).toEqual(applied);
});

test('an index that cannot be read starts afresh', async () => {
  const file = await indexFile();
  await writeFile(file, 'not a database, but long enough to look like a damaged one');
  expect(prepareIndex(file)).toBe(file);
  const database = connectIndex(file);
  onTestFinished(() => database.close());
  expect(migrationsOf(database).length).toBeGreaterThan(0);
});

test('an index a newer build migrated is left for that build', async () => {
  const file = await indexFile();
  const database = connectIndex(file);
  database
    .prepare('INSERT INTO __drizzle_migrations (hash, created_at, name) VALUES (?, ?, ?)')
    .run('', Date.now(), '29991231000000_from-the-future');
  database.close();
  expect(() => migrateIndex(new DatabaseSync(file))).toThrow(NewerIndexError);

  const before = await stat(file);
  vi.spyOn(process, 'emitWarning').mockImplementation(() => null);
  // This session keeps its index in memory instead, and the file stays as it was.
  expect(prepareIndex(file)).toBe(':memory:');
  expect((await stat(file)).ino).toBe(before.ino);
});

test('a library sorted by name or date taken reads straight from its index', () => {
  const database = connectIndex(':memory:');
  onTestFinished(() => database.close());
  const plans: string[] = [];
  const prepare = database.prepare.bind(database);
  vi.spyOn(database, 'prepare').mockImplementation((text) => {
    if (text.includes('json_group_array')) {
      plans.push(
        prepare(`EXPLAIN QUERY PLAN ${text}`)
          .all(1)
          .map((row) => String(row.detail))
          .join('\n'),
      );
    }
    return prepare(text);
  });
  const db = catalogDatabase(database);
  for (const sort of ['name', 'taken'] as const) {
    scopeOrder(db, 1, { directoryId: '.', recursive: true }, sort);
  }
  expect(plans.length).toBeGreaterThanOrEqual(2);
  for (const plan of plans) {
    expect(plan).toMatch(/USING (?:COVERING )?INDEX (?:folders_key|items_taken)/u);
    // Only names alike are sorted again, by entry number, rather than every row.
    expect(plan).not.toMatch(/TEMP B-TREE FOR ORDER BY/u);
  }
});

test('opening an index with migrations to apply says so first, but a new one or one up to date does not', async () => {
  const file = await indexFile();
  const upgrading = vi.fn();
  prepareIndex(file, upgrading);
  prepareIndex(file, upgrading);
  expect(upgrading).not.toHaveBeenCalled();

  const other = await indexFile();
  beforeFolders(other).close();
  prepareIndex(other, upgrading);
  expect(upgrading).toHaveBeenCalledOnce();
  const migrated = connectIndex(other);
  onTestFinished(() => migrated.close());
  expect(migrationsOf(migrated).filter((name) => name >= FOLDERS)).toEqual(SINCE_FOLDERS);
});

test('an index upgraded by a migration that frees much of it is vacuumed, and only then', async () => {
  const file = await indexFile();
  const before = beforeFolders(file);
  before.prepare('INSERT INTO libraries (root, used_ms) VALUES (?, 0)').run('/library');
  writeBeforeFolders(before, 1, libraryIds());
  before.close();
  const sizeBefore = pages(new DatabaseSync(file));

  const database = new DatabaseSync(file);
  onTestFinished(() => database.close());
  const exec = vi.spyOn(database, 'exec');
  migrateIndex(database);
  expect(exec).toHaveBeenCalledWith('VACUUM');
  expect(database.prepare('PRAGMA freelist_count').get()?.freelist_count).toBe(0);
  expect(pages(database)).toBeLessThan(sizeBefore);

  // Opened again up to date, or new, it is not.
  exec.mockClear();
  migrateIndex(database);
  const fresh = new DatabaseSync(':memory:');
  onTestFinished(() => fresh.close());
  const freshExec = vi.spyOn(fresh, 'exec');
  migrateIndex(fresh);
  expect([...exec.mock.calls, ...freshExec.mock.calls]).not.toContainEqual(['VACUUM']);
});

test('an index another worker is upgrading and vacuuming is waited for and kept, not upgraded twice', async () => {
  const file = await indexFile();
  const old = beforeFolders(file);
  old.prepare('INSERT INTO libraries (root, used_ms) VALUES (?, 0)').run('/library');
  const ids = libraryIds();
  writeBeforeFolders(old, 1, ids);
  old.close();
  const before = await stat(file);
  // Another folder's worker, upgrading the index for longer than a connection waits for a lock,
  // then vacuuming it, as `migrateIndex` does.
  const other = new Worker(
    `const { DatabaseSync } = require('node:sqlite');
    const { parentPort, workerData } = require('node:worker_threads');
    const database = new DatabaseSync(workerData.file, { timeout: 60000 });
    database.exec('BEGIN IMMEDIATE');
    parentPort.postMessage('locked');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 6000);
    for (const { name, sql } of workerData.migrations) {
      database.exec(sql.split('--> statement-breakpoint').join('\\n'));
      database.prepare('INSERT INTO __drizzle_migrations (hash, created_at, name) VALUES (?, ?, ?)')
        .run('', Date.now(), name);
    }
    database.exec('COMMIT');
    database.exec('VACUUM');
    database.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    database.close();
    parentPort.postMessage('vacuumed');`,
    {
      eval: true,
      workerData: {
        file,
        migrations: MIGRATIONS.filter(({ name }) => SINCE_FOLDERS.includes(name)),
      },
    },
  );
  onTestFinished(async () => {
    await other.terminate();
  });
  await once(other, 'message');
  const vacuumed = once(other, 'message');

  const upgrading = vi.fn();
  expect(prepareIndex(file, upgrading)).toBe(file);
  expect(upgrading).toHaveBeenCalledOnce();
  await vacuumed;
  expect((await stat(file)).ino).toBe(before.ino);
  const database = connectIndex(file);
  onTestFinished(() => database.close());
  const migrations = migrationsOf(database);
  expect(migrations.filter((name) => name >= FOLDERS)).toEqual(SINCE_FOLDERS);
  const db = catalogDatabase(database);
  expect(
    known(db, 1, ids)
      .map(({ id }) => id)
      .toSorted(),
  ).toEqual(ids.toSorted());
});
