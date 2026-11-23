import { MIGRATIONS } from '#__tests__/before-folders';
import { changedAt, details, entry, openCatalog, openDatabase } from '#__tests__/fixtures';
import { migrateIndex } from '#database/migrate';
import { openIndexToWrite } from '#database/photo-index';
import { forgetDetails } from '#details/forget-details';
import type { PhotoFile } from '#details/reusable-details';
import { entriesInOrder, itemOf } from '#repositories/items/entries';
import { removeLibrary } from '#writes/remove-library';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, onTestFinished, test } from 'vitest';

/** A photo with this inode, as a read lists it. */
function photo(id: string, inode: string, modifiedMs = 1000) {
  return entry(id, { metadata: { ...changedAt(modifiedMs), inode } });
}

/** The photo at `id` in the library at `/library`, as the enricher finds it on disk. */
function onDisk(id: string, inode: string, overrides: Partial<PhotoFile> = {}): PhotoFile {
  return { file: path.join('/library', id), id, inode, modifiedMs: 1000, size: 50, ...overrides };
}

/** The photo at `id` in the library at `/library/trip`, on a disk that reports no inode. */
function inTrip(id: string, overrides: Partial<PhotoFile> = {}): PhotoFile {
  return onDisk(id, '0', { file: path.join('/library/trip', id), ...overrides });
}

function removedCount(database: DatabaseSync) {
  return Number(database.prepare('SELECT count(*) AS count FROM removed_details').get()?.count);
}

function exifAt(catalog: ReturnType<typeof openCatalog>, id: string) {
  const item = itemOf(catalog.db, catalog.library, id);
  return item === undefined ? undefined : entriesInOrder(catalog.db, [item])[0]?.exif;
}

test('a photo moved where the app did not see it takes back the details its old row left', () => {
  const database = openDatabase();
  const catalog = openCatalog('/library', database);
  catalog.write([{ entries: [photo('a.jpg', '7'), photo('b.jpg', '8')], kind: 'list' }]);
  catalog.write([
    {
      details: [details('a.jpg', { camera: 'Canon' }), details('b.jpg', {})],
      kind: 'storeDetails',
    },
  ]);

  catalog.write([
    { ids: ['a.jpg', 'b.jpg'], kind: 'remove' },
    { entries: [photo('trip/a.jpg', '7')], kind: 'list' },
  ]);
  expect(removedCount(database)).toBe(2);
  const written = catalog.write([
    {
      kind: 'reuseDetails',
      photos: [onDisk('trip/a.jpg', '7'), onDisk('c.jpg', '8', { size: 51 })],
    },
  ]);

  // Only a file with the inode, size and time they were read at.
  expect(written.toRead).toEqual(['c.jpg']);
  expect(exifAt(catalog, 'trip/a.jpg')).toEqual({ camera: 'Canon' });
  // A row holds them again, so the table keeps only the other's.
  expect(removedCount(database)).toBe(1);
});

test('a photo with no inode, or of a library pruned, leaves no details behind', () => {
  const database = openDatabase();
  const catalog = openCatalog('/library', database);
  const pruned = openCatalog('/pruned', database);
  catalog.write([
    { entries: [photo('a.jpg', '0')], kind: 'list' },
    { details: [details('a.jpg', {})], kind: 'storeDetails' },
  ]);
  pruned.write([
    { entries: [photo('b.jpg', '9')], kind: 'list' },
    { details: [details('b.jpg', {})], kind: 'storeDetails' },
  ]);

  catalog.write([{ ids: ['a.jpg'], kind: 'remove' }]);
  removeLibrary(pruned.db, pruned.library);
  expect(removedCount(database)).toBe(0);
});

test('a photo another library holds too takes the details read there', () => {
  const database = openDatabase();
  const outer = openCatalog('/library', database);
  outer.write([{ entries: [photo('trip/a.jpg', '0')], kind: 'list' }]);
  outer.write([{ details: [details('trip/a.jpg', { iso: 400 })], kind: 'storeDetails' }]);

  // The folder opened as a library of its own.
  const inner = openCatalog('/library/trip', database);
  inner.write([{ entries: [photo('a.jpg', '0'), photo('b.jpg', '0')], kind: 'list' }]);
  const { toRead } = inner.write([
    {
      kind: 'reuseDetails',
      photos: [
        inTrip('a.jpg'),
        inTrip('b.jpg'),
        inTrip('a.jpg', { id: 'c.jpg', modifiedMs: 2000 }),
      ],
    },
  ]);
  expect(toRead).toEqual(['b.jpg', 'c.jpg']);
  expect(exifAt(inner, 'a.jpg')).toEqual({ iso: 400 });
});

test('forgetting every photo’s details forgets those of removed rows too', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'recalled-details-'));
  onTestFinished(() => rm(directory, { force: true, recursive: true }));
  const file = path.join(directory, 'photo-index.db');
  const database = openIndexToWrite(file);
  const catalog = openCatalog('/library', database);
  catalog.write([
    { entries: [photo('a.jpg', '7')], kind: 'list' },
    { details: [details('a.jpg', {})], kind: 'storeDetails' },
  ]);
  catalog.write([{ ids: ['a.jpg'], kind: 'remove' }]);
  database.close();

  forgetDetails(file);
  const after = new DatabaseSync(file);
  onTestFinished(() => after.close());
  expect(removedCount(after)).toBe(0);
});

test('the migration keeps the cached details no row holds, by inode, and drops the rest', () => {
  const database = new DatabaseSync(':memory:');
  onTestFinished(() => database.close());
  database.exec(`CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, hash text NOT NULL,
    created_at numeric, name text, applied_at TEXT)`);
  const record = database.prepare('INSERT INTO __drizzle_migrations (hash, name) VALUES (?, ?)');
  // Every migration but the removed details' own, as this build's writes need the others' columns.
  const others = MIGRATIONS.filter((each) => !each.name.includes('_removed-details'));
  for (const { name, sql } of others) {
    database.exec(sql.split('--> statement-breakpoint').join('\n'));
    record.run('', name);
  }
  const catalog = openCatalog('/library', database);
  catalog.write([
    { entries: [photo('held.jpg', '1')], kind: 'list' },
    { details: [details('held.jpg', {})], kind: 'storeDetails' },
  ]);
  const cache =
    database.prepare(`INSERT INTO exif (path, identity, size, modified_ms, exif, used_ms)
    VALUES (?, ?, 50, 1000, ?, 5)`);
  cache.run('/library/held.jpg', '16777234:1', '{}');
  cache.run('/library/trashed.jpg', '16777234:2', '{"iso":100}');
  cache.run('/share/none.jpg', null, '{}');

  migrateIndex(database);
  expect(database.prepare('SELECT * FROM removed_details').all()).toEqual([
    { exif: '{"iso":100}', inode: '2', modified_ms: 1000, removed_ms: 5, size: 50 },
  ]);
  expect(database.prepare("SELECT 1 FROM sqlite_schema WHERE name = 'exif'").get()).toBeUndefined();
});
