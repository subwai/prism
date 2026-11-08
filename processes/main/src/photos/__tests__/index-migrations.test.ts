import { catalogDatabase, scopeOrder } from '#photos/catalog-data';
import { migrateIndex, NewerIndexError } from '#photos/index-migrations';
import { connectIndex, PhotoIndex } from '#photos/photo-index';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
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
  const index = PhotoIndex.open(file);
  onTestFinished(() => index.close());
  // This session keeps its index in memory instead, and the file stays as it was.
  expect(index.file).toBe(':memory:');
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
