import { changedAt, details, entry, openCatalog, openDatabase } from '#__tests__/fixtures';
import { everyFolder, foldersAt } from '#data/contents';
import { catalogDatabase } from '#data/database';
import { storedSkeleton, storeSkeleton } from '#data/folder-skeletons';
import {
  folderSkeleton,
  folderTiles,
  keepSkeleton,
  SKELETON_FORMAT,
  skeletonText,
} from '#folder-skeleton';
import type { CatalogWrite } from '#writes';
import { expect, test, vi } from 'vitest';

test("the tree's folders are every folder of the library, siblings by name", () => {
  const catalog = openCatalog();
  const other = openCatalog('/other', openDatabase());
  other.write([{ listed: [entry('Elsewhere')] }]);
  catalog.write([
    {
      listed: [
        entry('Trips'),
        entry('Trips/Beach 10'),
        entry('Trips/beach 9'),
        entry('Trips/Beach 10/a.jpg'),
        entry('Album'),
        entry('notes.txt', { kind: 'file' }),
      ],
    },
    { indexed: '.' },
    { indexed: 'Trips' },
    { indexed: 'Trips/Beach 10' },
  ]);
  // Each folder's tile: whether it holds anything, and anything that is a folder, and its
  // covers, which Trips borrows from the folder inside it with any, so they go once.
  const covers = [[['Trips/Beach 10/a.jpg', 'image', 50, 1000, null]]];
  expect(folderSkeleton(catalog.db, catalog.library)).toEqual({
    covers,
    folders: [
      ['Album', '.', 'Album', [false, false, -1]],
      ['Trips', '.', 'Trips', [true, true, 0]],
      ['Trips/beach 9', 'Trips', 'beach 9', [false, false, -1]],
      ['Trips/Beach 10', 'Trips', 'Beach 10', [true, false, 0]],
    ],
    listed: ['.', 'Trips', 'Trips/Beach 10'],
    // The library's folder, which no folder holds, has a tile too, borrowing Trips' covers.
    root: [[true, true, 0], true],
  });
  // Only the folders inside those asked about, and which of them were read, so a read of some
  // folders' subfolders again keeps theirs, and the library's folder's tile, which every
  // skeleton has.
  expect(folderSkeleton(catalog.db, catalog.library, ['Trips', 'Album'])).toEqual({
    covers,
    folders: [
      ['Trips/beach 9', 'Trips', 'beach 9', [false, false, -1]],
      ['Trips/Beach 10', 'Trips', 'Beach 10', [true, false, 0]],
    ],
    listed: ['Trips/Beach 10'],
    root: [[true, true, 0], true],
  });
});

test("the library's folders are read in order through the index by name, with nothing to sort", () => {
  const database = openDatabase();
  const plans: string[] = [];
  const prepare = database.prepare.bind(database);
  vi.spyOn(database, 'prepare').mockImplementation((text) => {
    plans.push(
      prepare(`EXPLAIN QUERY PLAN ${text}`)
        .all()
        .map((row) => String(row.detail))
        .join('\n'),
    );
    return prepare(text);
  });
  everyFolder(catalogDatabase(database), 1);
  expect(plans.length).toBeGreaterThanOrEqual(1);
  for (const plan of plans) {
    expect(plan).toMatch(/SEARCH folders USING INDEX folders_key \(library=\?\)/u);
    expect(plan).toMatch(/SEARCH items USING INDEX items_parent \(parent=\? AND grp=\?\)/u);
    expect(plan).not.toMatch(/TEMP B-TREE/u);
  }
});

test('the skeleton is kept ready-made until a write changes what it shows, its covers included', () => {
  const catalog = openCatalog();
  const { db, library } = catalog;
  const photos = ['a', 'b', 'c', 'd'].map((name) => entry(`Trips/Beach/${name}.jpg`));
  catalog.write([
    { listed: [entry('Trips'), entry('Trips/Beach'), ...photos] },
    { indexed: '.' },
    { indexed: 'Trips' },
  ]);
  const fresh = () => JSON.stringify(folderSkeleton(db, library));
  const kept = () => storedSkeleton(db, library, SKELETON_FORMAT);
  function keepAgain() {
    keepSkeleton(db, library);
    expect(kept()).toBe(fresh());
    expect(skeletonText(db, library)).toBe(kept());
  }
  /** Whether `writes` leave the skeleton kept, which is then the same as one made afresh. */
  function keptAfter(...writes: CatalogWrite[]) {
    keepAgain();
    catalog.write(writes);
    const stays = kept() !== null;
    expect(skeletonText(db, library)).toBe(fresh());
    return stays;
  }

  // Writes the skeleton does not show: a listing as the catalog has it, a photo past the
  // covers, and photos' details.
  expect(keptAfter({ listed: photos })).toBe(true);
  expect(keptAfter({ listed: [entry('Trips/Beach/e.jpg')] })).toBe(true);
  expect(keptAfter({ details: [details('Trips/Beach/a.jpg', { camera: 'X100' })] })).toBe(true);
  expect(keptAfter({ removed: ['Trips/Beach/e.jpg'] })).toBe(true);

  // A cover rewritten has another size, time or inode, which name its thumbnail, in the tiles
  // of the folder holding it and of the folders borrowing from it.
  const rewritten = entry('Trips/Beach/a.jpg', { metadata: changedAt(2000) });
  expect(keptAfter({ listed: [rewritten] })).toBe(false);
  expect(keptAfter({ removed: ['Trips/Beach/b.jpg'] })).toBe(false);
  // Folders that come, go or are read to the end.
  expect(keptAfter({ listed: [entry('Album')] })).toBe(false);
  expect(keptAfter({ indexed: 'Trips/Beach' })).toBe(false);
  expect(keptAfter({ removed: ['Album'] })).toBe(false);
});

test('a skeleton another build kept in another shape is made afresh', () => {
  const catalog = openCatalog();
  catalog.write([{ listed: [entry('Trips')] }]);
  storeSkeleton(catalog.db, catalog.library, SKELETON_FORMAT + 1, '{"folders":"otherwise"}');
  expect(JSON.parse(skeletonText(catalog.db, catalog.library))).toEqual(
    folderSkeleton(catalog.db, catalog.library),
  );
});

test("the folders whose tiles changed are read by ID, alone, with the library's folder's tile", () => {
  const catalog = openCatalog();
  catalog.write([
    { listed: [entry('Trips'), entry('Trips/Beach'), entry('Trips/Beach/a.jpg'), entry('b.jpg')] },
    { indexed: 'Trips/Beach' },
  ]);
  const covers = [
    [['Trips/Beach/a.jpg', 'image', 50, 1000, null]],
    [['b.jpg', 'image', 50, 1000, null]],
  ];
  // A photo is no folder, and one the catalog has not is left out.
  expect(folderTiles(catalog.db, catalog.library, ['Trips/Beach', 'b.jpg', 'Gone'])).toEqual({
    covers,
    folders: [['Trips/Beach', 'Trips', 'Beach', [true, false, 0]]],
    listed: ['Trips/Beach'],
    root: [[true, true, 1], false],
  });
});

test('folders are found by ID through the index on their IDs', () => {
  const database = openDatabase();
  const plans: string[] = [];
  const prepare = database.prepare.bind(database);
  vi.spyOn(database, 'prepare').mockImplementation((text) => {
    plans.push(
      prepare(`EXPLAIN QUERY PLAN ${text}`)
        .all()
        .map((row) => String(row.detail))
        .join('\n'),
    );
    return prepare(text);
  });
  foldersAt(catalogDatabase(database), 1, ['Trips']);
  const plan = plans.join('\n');
  expect(plan).toMatch(/USING INDEX items_entry \(parent=\? AND name=\?\)/u);
  expect(plan).toMatch(
    /SEARCH folders USING COVERING INDEX folders_path \(library=\? AND path=\?\)/u,
  );
});
