import { entry, openCatalog } from '#__tests__/fixtures';
import { parentKey } from '#data/codes';
import { catalogDatabase } from '#data/database';
import { scopeOrder } from '#data/orders';
import { migrateIndex, NewerIndexError } from '#index-migrations';
import { connectIndex, prepareIndex } from '#photo-index';
import parentKeys from '../migrations/20261115002557_parent-keys/migration.sql?raw';
import folderStamps from '../migrations/20261116045435_folder-stamps/migration.sql?raw';
import { once } from 'node:events';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Worker } from 'node:worker_threads';
import { expect, onTestFinished, test, vi } from 'vitest';

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
    expect(plan).toMatch(/USING (?:COVERING )?INDEX items_(?:name|taken)/u);
    // Only names alike are sorted again, by entry number, rather than every row.
    expect(plan).not.toMatch(/TEMP B-TREE FOR ORDER BY/u);
  }
});

test("the migration that adds parents' keys gives the entries already listed those the writer gives", () => {
  const database = connectIndex(':memory:');
  onTestFinished(() => database.close());
  const catalog = openCatalog('/library', database);
  const ids = [
    'a',
    'a/1.jpg',
    'a/Ö 10',
    'a/Ö 10/1.jpg',
    'b.jpg',
    'c',
    'c/d',
    'c/d/e',
    'c/d/e/1.jpg',
  ];
  catalog.write([{ listed: ids.map((id) => entry(id)) }]);
  const read = () => database.prepare('SELECT id, parent_key FROM items ORDER BY id').all();
  const written = read();
  expect(written).toContainEqual({ id: 'c/d/e/1.jpg', parent_key: parentKey('c/d/e') });

  // The index as it was before the migration, with the entries in it.
  database.exec(`DROP INDEX items_name;
    ALTER TABLE items DROP COLUMN parent_key;
    CREATE INDEX items_name ON items (library, grp, name_key, kind);`);
  for (const statement of parentKeys.split('--> statement-breakpoint')) {
    database.exec(statement);
  }
  expect(read()).toEqual(written);
});

test("the migration that adds parents' keys finds each folder's subfolders by its parent", () => {
  const database = connectIndex(':memory:');
  onTestFinished(() => database.close());
  const [, folderKeys = ''] = parentKeys.split('--> statement-breakpoint');
  const plan = database
    .prepare(`EXPLAIN QUERY PLAN ${folderKeys}`)
    .all()
    .map((row) => String(row.detail))
    .join('\n');
  // Through every folder of the library instead, a catalog of 40,000 folders takes 17 minutes.
  expect(plan).toMatch(/SEARCH items USING INDEX items_parent \(library=\? AND parent_id=\?\)/u);
  expect(plan).not.toMatch(/items_kind/u);
});

/** Takes `file` back to before its last migration, which adds folders' stamps; returns its name. */
function beforeFolderStamps(file: string) {
  const database = connectIndex(file);
  const [last] = migrationsOf(database).toReversed();
  for (const column of ['modified_ms', 'changed_ms', 'inode']) {
    database.exec(`ALTER TABLE indexed_folders DROP COLUMN ${column}`);
  }
  database.prepare('DELETE FROM __drizzle_migrations WHERE name = ?').run(last ?? '');
  database.close();
  expect(last).toBe('20261116045435_folder-stamps');
  return last;
}

test('opening an index with migrations to apply says so first, but a new one or one up to date does not', async () => {
  const file = await indexFile();
  const upgrading = vi.fn();
  prepareIndex(file, upgrading);
  prepareIndex(file, upgrading);
  expect(upgrading).not.toHaveBeenCalled();

  const last = beforeFolderStamps(file);
  prepareIndex(file, upgrading);
  expect(upgrading).toHaveBeenCalledOnce();
  const migrated = connectIndex(file);
  onTestFinished(() => migrated.close());
  expect(migrationsOf(migrated).at(-1)).toBe(last);
});

test('an index another worker is upgrading is waited for and kept, not upgraded twice', async () => {
  const file = await indexFile();
  prepareIndex(file);
  const last = beforeFolderStamps(file);
  const before = await stat(file);
  // Another folder's worker, upgrading the index for longer than a connection waits for a lock.
  const other = new Worker(
    `const { DatabaseSync } = require('node:sqlite');
    const { parentPort, workerData } = require('node:worker_threads');
    const database = new DatabaseSync(workerData.file);
    database.exec('BEGIN IMMEDIATE');
    parentPort.postMessage('locked');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 6000);
    database.exec(workerData.sql.split('--> statement-breakpoint').join(''));
    database.prepare('INSERT INTO __drizzle_migrations (hash, created_at, name) VALUES (?, ?, ?)')
      .run('', Date.now(), workerData.last);
    database.exec('COMMIT');
    database.close();`,
    { eval: true, workerData: { file, last, sql: folderStamps } },
  );
  onTestFinished(async () => {
    await other.terminate();
  });
  await once(other, 'message');

  const upgrading = vi.fn();
  expect(prepareIndex(file, upgrading)).toBe(file);
  expect(upgrading).toHaveBeenCalledOnce();
  expect((await stat(file)).ino).toBe(before.ino);
  const database = connectIndex(file);
  onTestFinished(() => database.close());
  expect(migrationsOf(database).filter((name) => name === last)).toHaveLength(1);
}, 15_000);
