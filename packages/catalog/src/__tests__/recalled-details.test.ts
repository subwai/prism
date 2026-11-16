import { MIGRATIONS } from '#__tests__/before-folders';
import { changedAt, details, entry, openCatalog, openDatabase } from '#__tests__/fixtures';
import { entries, itemOf } from '#data/items';
import { removeLibrary } from '#data/libraries';
import { migrateIndex } from '#index-migrations';
import { connectIndex, forgetDetails } from '#photo-index';
import type { PhotoFile } from '#recalled-details';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, onTestFinished, test } from 'vitest';

const REMOVED_DETAILS = '20261116202947_removed-details';

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
  return item === undefined ? undefined : entries(catalog.db, [item])[0]?.exif;
}

test('a photo moved where the app did not see it takes back the details its old row left', () => {
  const database = openDatabase();
  const catalog = openCatalog('/library', database);
  catalog.write([{ listed: [photo('a.jpg', '7'), photo('b.jpg', '8')] }]);
  catalog.write([{ details: [details('a.jpg', { camera: 'Canon' }), details('b.jpg', {})] }]);

  catalog.write([{ removed: ['a.jpg', 'b.jpg'] }, { listed: [photo('trip/a.jpg', '7')] }]);
  expect(removedCount(database)).toBe(2);
  const written = catalog.write([
    { recalled: [onDisk('trip/a.jpg', '7'), onDisk('c.jpg', '8', { size: 51 })] },
  ]);

  // Only a file with the inode, size and time they were read at.
  expect(written.unrecalled).toEqual(['c.jpg']);
  expect(exifAt(catalog, 'trip/a.jpg')).toEqual({ camera: 'Canon' });
  // A row holds them again, so the table keeps only the other's.
  expect(removedCount(database)).toBe(1);
});

test('a photo with no inode, or of a library pruned, leaves no details behind', () => {
  const database = openDatabase();
  const catalog = openCatalog('/library', database);
  const pruned = openCatalog('/pruned', database);
  catalog.write([{ listed: [photo('a.jpg', '0')] }, { details: [details('a.jpg', {})] }]);
  pruned.write([{ listed: [photo('b.jpg', '9')] }, { details: [details('b.jpg', {})] }]);

  catalog.write([{ removed: ['a.jpg'] }]);
  removeLibrary(pruned.db, pruned.library);
  expect(removedCount(database)).toBe(0);
});

test('a photo another library holds too takes the details read there', () => {
  const database = openDatabase();
  const outer = openCatalog('/library', database);
  outer.write([{ listed: [photo('trip/a.jpg', '0')] }]);
  outer.write([{ details: [details('trip/a.jpg', { iso: 400 })] }]);

  // The folder opened as a library of its own.
  const inner = openCatalog('/library/trip', database);
  inner.write([{ listed: [photo('a.jpg', '0'), photo('b.jpg', '0')] }]);
  const { unrecalled } = inner.write([
    {
      recalled: [
        inTrip('a.jpg'),
        inTrip('b.jpg'),
        inTrip('a.jpg', { id: 'c.jpg', modifiedMs: 2000 }),
      ],
    },
  ]);
  expect(unrecalled).toEqual(['b.jpg', 'c.jpg']);
  expect(exifAt(inner, 'a.jpg')).toEqual({ iso: 400 });
});

test('forgetting every photo’s details forgets those of removed rows too', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'recalled-details-'));
  onTestFinished(() => rm(directory, { force: true, recursive: true }));
  const file = path.join(directory, 'photo-index.db');
  const database = connectIndex(file);
  const catalog = openCatalog('/library', database);
  catalog.write([{ listed: [photo('a.jpg', '7')] }, { details: [details('a.jpg', {})] }]);
  catalog.write([{ removed: ['a.jpg'] }]);
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
  for (const { name, sql } of MIGRATIONS.filter((each) => each.name < REMOVED_DETAILS)) {
    database.exec(sql.split('--> statement-breakpoint').join('\n'));
    record.run('', name);
  }
  const catalog = openCatalog('/library', database);
  catalog.write([{ listed: [photo('held.jpg', '1')] }, { details: [details('held.jpg', {})] }]);
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
