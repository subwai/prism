import { entry, openCatalog, openDatabase } from '#__tests__/fixtures';
import { catalogDatabase } from '#database/catalog-database';
import { folderNumber, foldersInside } from '#repositories/folders';
import { catalogEntriesAt, entriesInOrder } from '#repositories/items/entries';
import { entriesIn } from '#repositories/items/folder-contents';
import { registerLibrary } from '#repositories/libraries';
import { nameFold, nameKey, parentKey } from '#repositories/queries/codes';
import type { DatabaseSync } from 'node:sqlite';
import { expect, test } from 'vitest';

interface FolderRow {
  folder: number;
  path: string;
  key: string;
  item: number | null;
}

function foldersOf(database: DatabaseSync): FolderRow[] {
  return database
    .prepare('SELECT folder, path, key, item FROM folders ORDER BY path')
    .all() as unknown as FolderRow[];
}

/** The folders' paths and keys, and whether each has a row. */
function folderPaths(database: DatabaseSync) {
  return database
    .prepare('SELECT path, key, item IS NOT NULL AS rowed FROM folders ORDER BY path')
    .all();
}

/** Adds an entry to `items` as a write would, with no help from the repositories. */
function insert(database: DatabaseSync, parent: number, name: string, kind: number): number {
  const row = database
    .prepare(
      `INSERT INTO items (library, parent, name, name_key, name_fold, kind, grp)
      VALUES (1, ?, ?, ?, ?, ?, ?) RETURNING item`,
    )
    .get(parent, name, nameKey(name), nameFold(name), kind, kind === 0 ? 0 : 1) as {
    item: number;
  };
  return row.item;
}

function remove(database: DatabaseSync, item: number) {
  database.prepare('DELETE FROM items WHERE item = ?').run(item);
}

/** A catalog of one library at `root`, and its own folder's number. */
function openLibrary(root = '/library') {
  const database = openDatabase();
  const db = catalogDatabase(database);
  expect(registerLibrary(db, root)).toBe(1);
  return { database, root: folderNumber(db, 1, '.') };
}

/** That every entry is in a folder `folders` has, and every folder's row is its own. */
function expectFoldersTrue(database: DatabaseSync) {
  expect(
    database
      .prepare('SELECT item FROM items WHERE parent NOT IN (SELECT folder FROM folders)')
      .all(),
  ).toEqual([]);
  expect(
    database
      .prepare(
        `SELECT folders.path FROM folders LEFT JOIN items ON items.item = folders.item
        WHERE folders.item IS NOT NULL AND (items.item IS NULL OR items.kind <> 0)`,
      )
      .all(),
  ).toEqual([]);
  expect(
    database
      .prepare(
        `SELECT path FROM folders WHERE item IS NULL
        AND NOT EXISTS (SELECT 1 FROM items WHERE parent = folders.folder)`,
      )
      .all(),
  ).toEqual([]);
}

test("a folder that comes is kept by its path and key, its parent's and its name joined", () => {
  const { database, root } = openLibrary();
  const trips = insert(database, root, 'Trips', 0);
  const tripsFolder = foldersOf(database).find((row) => row.path === 'Trips')?.folder ?? 0;
  const beach = insert(database, tripsFolder, 'Ö 10', 0);
  insert(database, tripsFolder, 'a.jpg', 1);
  expect(foldersOf(database).map(({ path, key, item }) => ({ item, key, path }))).toEqual([
    { item: null, key: '', path: '.' },
    { item: trips, key: parentKey('Trips'), path: 'Trips' },
    { item: beach, key: parentKey('Trips/Ö 10'), path: 'Trips/Ö 10' },
  ]);
  expectFoldersTrue(database);
});

test('the folders inside a folder are found however deep, and inside the library every one', () => {
  const { database, root } = openLibrary();
  insert(database, root, 'Trips', 0);
  insert(database, root, 'a.jpg', 1);
  const trips = foldersOf(database).find((row) => row.path === 'Trips')?.folder ?? 0;
  insert(database, trips, 'Beach', 0);
  const db = catalogDatabase(database);
  expect(foldersInside(db, 1, '.').toSorted()).toEqual(['Trips', 'Trips/Beach']);
  expect(foldersInside(db, 1, 'Trips')).toEqual(['Trips/Beach']);
});

test("a folder's path is joined as the library's paths are, with `\\` on Windows", () => {
  const { database, root } = openLibrary(String.raw`C:\Photos`);
  insert(database, root, 'Trips', 0);
  const [, trips] = foldersOf(database);
  insert(database, trips?.folder ?? 0, 'Beach', 0);
  expect(foldersOf(database).map((row) => row.path)).toEqual([
    '.',
    'Trips',
    String.raw`Trips\Beach`,
  ]);
});

test('a folder whose row goes keeps its number while entries are in it, and goes with the last', () => {
  const { database, root } = openLibrary();
  const trips = insert(database, root, 'Trips', 0);
  const empty = insert(database, root, 'Empty', 0);
  const tripsFolder = foldersOf(database).find((row) => row.path === 'Trips')?.folder ?? 0;
  const photo = insert(database, tripsFolder, 'a.jpg', 1);

  remove(database, empty);
  expect(foldersOf(database).map((row) => row.path)).toEqual(['.', 'Trips']);
  remove(database, trips);
  expect(foldersOf(database)).toContainEqual({
    folder: tripsFolder,
    item: null,
    key: 'trips',
    path: 'Trips',
  });
  expectFoldersTrue(database);

  // Its last entry takes it, and the library's folder with it, as nothing is left in either.
  remove(database, photo);
  expect(foldersOf(database)).toEqual([]);
});

test("an entry that changes kind gains or loses its folder's row", () => {
  const { database, root } = openLibrary();
  const item = insert(database, root, 'Trips', 1);
  expect(foldersOf(database).map((row) => row.path)).toEqual(['.']);

  database.prepare('UPDATE items SET kind = 0, grp = 0 WHERE item = ?').run(item);
  const [, trips] = foldersOf(database);
  expect(trips).toMatchObject({ item, path: 'Trips' });
  insert(database, trips?.folder ?? 0, 'a.jpg', 1);

  // A file again, with what was inside it still there, which keeps its folder, row or not.
  database.prepare('UPDATE items SET kind = 1, grp = 1 WHERE item = ?').run(item);
  expect(foldersOf(database)).toContainEqual({ ...trips, item: null });
  expectFoldersTrue(database);
});

test('a folder whose row comes after what is inside it keeps it, as one whose row came first', () => {
  const ids = ['a', 'a/b', 'a/b/c.jpg', 'a/d.jpg'];
  const laterDatabase = openDatabase();
  const later = openCatalog('/library', laterDatabase);
  later.write([{ entries: [entry('a/b/c.jpg')], kind: 'list' }]);
  later.write([{ entries: [entry('a/d.jpg')], kind: 'list' }]);
  later.write([{ entries: [entry('a'), entry('a/b')], kind: 'list' }]);
  const earlierDatabase = openDatabase();
  const earlier = openCatalog('/library', earlierDatabase);
  earlier.write([{ entries: ids.map((id) => entry(id)), kind: 'list' }]);

  for (const catalog of [later, earlier]) {
    expect(
      catalogEntriesAt(catalog.db, catalog.library, ids)
        .map(({ id }) => id)
        .toSorted(),
    ).toEqual(ids);
    expect(
      entriesInOrder(catalog.db, entriesIn(catalog.db, catalog.library, 'a/b')).map(({ id }) => id),
    ).toEqual(['a/b/c.jpg']);
  }
  expect(folderPaths(laterDatabase)).toEqual(folderPaths(earlierDatabase));
  expectFoldersTrue(laterDatabase);
});

test('removing a folder leaves no folder of what was inside it', () => {
  const database = openDatabase();
  const catalog = openCatalog('/library', database);
  catalog.write([
    {
      entries: ['a', 'a/b', 'a/b/c', 'a/b/c/d.jpg', 'a/e.jpg', 'ab', 'ab/f.jpg'].map((id) =>
        entry(id),
      ),
      kind: 'list',
    },
  ]);
  catalog.write([{ ids: ['a'], kind: 'remove' }]);
  expect(foldersOf(database).map((row) => row.path)).toEqual(['.', 'ab']);
  expectFoldersTrue(database);
});
