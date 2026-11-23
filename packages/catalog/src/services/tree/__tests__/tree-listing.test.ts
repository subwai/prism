import { changedAt, details, entry, openCatalog, openDatabase } from '#__tests__/fixtures';
import { catalogDatabase } from '#database/catalog-database';
import { everyFolder, foldersAt } from '#repositories/items/folder-contents';
import { readStoredTreeListing, writeStoredTreeListing } from '#repositories/tree-listings';
import {
  listFoldersById,
  listSubfolders,
  listWholeTree,
  storeTreeListing,
  TREE_LISTING_FORMAT,
  wholeTreeListingText,
} from '#services/tree/tree-listing';
import type { CatalogWrite } from '#services/writes/write-catalog';
import { type TreeFolderCover, treeListingFromText, treeListingToText } from '@prism/shared';
import { expect, test, vi } from 'vitest';

/** Sets of covers as a tree listing has them, a line each. */
function coverLines(...sets: TreeFolderCover[][]) {
  return sets.map((set) => `${JSON.stringify(set)}\n`).join('');
}

test("the tree's folders are every folder of the library, siblings by name", () => {
  const catalog = openCatalog();
  const other = openCatalog('/other', openDatabase());
  other.write([{ entries: [entry('Elsewhere')], kind: 'list' }]);
  catalog.write([
    {
      entries: [
        entry('Trips'),
        entry('Trips/Beach 10'),
        entry('Trips/beach 9'),
        entry('Trips/Beach 10/a.jpg'),
        entry('Album'),
        entry('notes.txt', { kind: 'file' }),
      ],
      kind: 'list',
    },
    { folderId: '.', kind: 'markIndexed' },
    { folderId: 'Trips', kind: 'markIndexed' },
    { folderId: 'Trips/Beach 10', kind: 'markIndexed' },
  ]);
  // Each folder's tile: whether it holds anything, and anything that is a folder, where its
  // covers start, which Trips borrows from the folder inside it with any, so they go once, and
  // whether it was read to the end. Folders come under the folder holding them.
  const covers = coverLines([['Trips/Beach 10/a.jpg', 'image', 50, 1000, null]]);
  const trips = [
    ['Trips/beach 9', 'beach 9', [false, false, -1, false]],
    ['Trips/Beach 10', 'Beach 10', [true, false, 0, true]],
  ];
  expect(listWholeTree(catalog.db, catalog.library)).toEqual({
    covers,
    folders: [
      [
        '.',
        [
          ['Album', 'Album', [false, false, -1, false]],
          ['Trips', 'Trips', [true, true, 0, true]],
        ],
      ],
      ['Trips', trips],
    ],
    // The library's folder, which no folder holds, has a tile too, borrowing Trips' covers.
    root: [true, true, 0, true],
  });
  // Only the folders inside those asked about, so a read of some folders' subfolders again
  // keeps theirs, and the library's folder's tile, which every tree listing has.
  expect(listSubfolders(catalog.db, catalog.library, ['Trips', 'Album'])).toEqual({
    covers,
    folders: [['Trips', trips]],
    root: [true, true, 0, true],
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

test('the tree listing is kept ready-made until a write changes what it shows, its covers included', () => {
  const catalog = openCatalog();
  const { db, library } = catalog;
  const photos = ['a', 'b', 'c', 'd'].map((name) => entry(`Trips/Beach/${name}.jpg`));
  catalog.write([
    { entries: [entry('Trips'), entry('Trips/Beach'), ...photos], kind: 'list' },
    { folderId: '.', kind: 'markIndexed' },
    { folderId: 'Trips', kind: 'markIndexed' },
  ]);
  const fresh = () => treeListingToText(listWholeTree(db, library));
  const kept = () => readStoredTreeListing(db, library, TREE_LISTING_FORMAT);
  function keepAgain() {
    storeTreeListing(db, library);
    expect(kept()).toBe(fresh());
    expect(wholeTreeListingText(db, library)).toBe(kept());
  }
  /** Whether `writes` leave the tree listing kept, which is then the same as one made afresh. */
  function keptAfter(...writes: CatalogWrite[]) {
    keepAgain();
    catalog.write(writes);
    const stays = kept() !== null;
    expect(wholeTreeListingText(db, library)).toBe(fresh());
    return stays;
  }

  // Writes the tree listing does not show: a folder's contents as the catalog has them, a photo past the
  // covers, and photos' details.
  expect(keptAfter({ entries: photos, kind: 'list' })).toBe(true);
  expect(keptAfter({ entries: [entry('Trips/Beach/e.jpg')], kind: 'list' })).toBe(true);
  expect(
    keptAfter({
      details: [details('Trips/Beach/a.jpg', { camera: 'X100' })],
      kind: 'storeDetails',
    }),
  ).toBe(true);
  expect(keptAfter({ ids: ['Trips/Beach/e.jpg'], kind: 'remove' })).toBe(true);

  // A cover rewritten has another size, time or inode, which name its thumbnail, in the tiles
  // of the folder holding it and of the folders borrowing from it.
  const rewritten = entry('Trips/Beach/a.jpg', { metadata: changedAt(2000) });
  expect(keptAfter({ entries: [rewritten], kind: 'list' })).toBe(false);
  expect(keptAfter({ ids: ['Trips/Beach/b.jpg'], kind: 'remove' })).toBe(false);
  // Folders that come, go or are read to the end.
  expect(keptAfter({ entries: [entry('Album')], kind: 'list' })).toBe(false);
  expect(keptAfter({ folderId: 'Trips/Beach', kind: 'markIndexed' })).toBe(false);
  expect(keptAfter({ ids: ['Album'], kind: 'remove' })).toBe(false);
});

test('a tree listing another build kept in another shape is made afresh', () => {
  const catalog = openCatalog();
  catalog.write([{ entries: [entry('Trips')], kind: 'list' }]);
  writeStoredTreeListing(
    catalog.db,
    catalog.library,
    TREE_LISTING_FORMAT + 1,
    '{"folders":"otherwise"}',
  );
  expect(treeListingFromText(wholeTreeListingText(catalog.db, catalog.library))).toEqual(
    listWholeTree(catalog.db, catalog.library),
  );
});

test("the folders whose tiles changed are read by ID, alone, with the library's folder's tile", () => {
  const catalog = openCatalog();
  catalog.write([
    {
      entries: [entry('Trips'), entry('Trips/Beach'), entry('Trips/Beach/a.jpg'), entry('b.jpg')],
      kind: 'list',
    },
    { folderId: 'Trips/Beach', kind: 'markIndexed' },
  ]);
  const beach: TreeFolderCover[] = [['Trips/Beach/a.jpg', 'image', 50, 1000, null]];
  const covers = coverLines(beach, [['b.jpg', 'image', 50, 1000, null]]);
  // A photo is no folder, and one the catalog has not is left out.
  expect(listFoldersById(catalog.db, catalog.library, ['Trips/Beach', 'b.jpg', 'Gone'])).toEqual({
    covers,
    folders: [['Trips', [['Trips/Beach', 'Beach', [true, false, 0, true]]]]],
    root: [true, true, coverLines(beach).length, false],
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
