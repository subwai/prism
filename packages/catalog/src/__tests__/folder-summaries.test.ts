import { changedAt, entry, openCatalog, openDatabase, type TestCatalog } from '#__tests__/fixtures';
import { catalogDatabase } from '#data/database';
import {
  coverFiles,
  firstLenderCovers,
  librarySummary,
  storeSummary,
  summaryAt,
  tilesAt,
} from '#data/folder-summaries';
import { entriesByNumber } from '#data/items';
import { withSummaries } from '#folder-summaries';
import { expect, test, vi } from 'vitest';

/** The tile a read gives the folder `id`, its covers by ID. */
function tileOf(catalog: TestCatalog, id: string) {
  const [found] = withSummaries(catalog.db, catalog.library, catalog.stored, [entry(id)]);
  const summary = found?.summary;
  return summary && { ...summary, covers: summary.covers.map((cover) => cover.id) };
}

/** The covers a read gives the folder `id`, by ID. */
function coversOf(catalog: TestCatalog, id: string) {
  return tileOf(catalog, id)?.covers;
}

test("a folder's tile says what it holds, and its own photos and videos, photos first", () => {
  const catalog = openCatalog();
  catalog.write([
    {
      listed: [
        entry('Trip'),
        entry('Trip/clip.mov', { kind: 'video' }),
        entry('Trip/notes.txt', { kind: 'file' }),
        ...['e', 'd', 'c', 'b', 'a'].map((name) => entry(`Trip/${name}.jpg`)),
        entry('Trip/Day'),
        entry('Empty'),
      ],
    },
    { indexed: 'Trip' },
  ]);
  expect(tileOf(catalog, 'Trip')).toEqual({
    covers: ['Trip/a.jpg', 'Trip/b.jpg', 'Trip/c.jpg', 'Trip/d.jpg'],
    hasEntries: true,
    hasSubfolders: true,
    read: true,
  });
  expect(tileOf(catalog, 'Empty')).toEqual({
    covers: [],
    hasEntries: false,
    hasSubfolders: false,
    read: false,
  });

  catalog.write([{ removed: ['Trip/a.jpg', 'Trip/b.jpg', 'Trip/c.jpg', 'Trip/d.jpg'] }]);
  expect(coversOf(catalog, 'Trip')).toEqual(['Trip/e.jpg', 'Trip/clip.mov']);
  // A rename lists the new name and removes the old one.
  catalog.write([{ listed: [entry('Trip/0.jpg')] }, { removed: ['Trip/e.jpg'] }]);
  expect(coversOf(catalog, 'Trip')).toEqual(['Trip/0.jpg', 'Trip/clip.mov']);
  catalog.write([{ removed: ['Trip/Day'] }]);
  expect(tileOf(catalog, 'Trip')).toMatchObject({ hasSubfolders: false });
});

test('a cover shows its file as it is now, and its rating', () => {
  const catalog = openCatalog();
  catalog.write([{ listed: [entry('Trip'), entry('Trip/a.jpg')] }]);
  catalog.write([
    { listed: [entry('Trip/a.jpg', { metadata: { ...changedAt(2000), inode: '7' } })] },
  ]);
  const [found] = withSummaries(catalog.db, catalog.library, catalog.stored, [entry('Trip')]);
  expect(found?.summary?.covers[0]?.metadata).toMatchObject({ inode: '7', modifiedMs: 2000 });
});

test('a folder with no photos of its own borrows those of the first folder inside it with any, however deep', () => {
  const catalog = openCatalog();
  catalog.write([
    {
      listed: [
        entry('2024'),
        entry('2024/01 Empty'),
        entry('2024/02 Trip'),
        entry('2024/02 Trip/Day 1'),
        entry('2024/02 Trip/Day 1/a.jpg'),
        entry('2024/03 Home'),
        entry('2024/03 Home/b.jpg'),
      ],
    },
  ]);
  // The first by name with any, own or borrowed, rather than the shallowest.
  expect(coversOf(catalog, '2024')).toEqual(['2024/02 Trip/Day 1/a.jpg']);
  expect(coversOf(catalog, '2024/02 Trip')).toEqual(['2024/02 Trip/Day 1/a.jpg']);

  // A photo of its own takes over, and is passed up in turn.
  catalog.write([{ listed: [entry('2024/02 Trip/z.jpg')] }]);
  expect(coversOf(catalog, '2024/02 Trip')).toEqual(['2024/02 Trip/z.jpg']);
  expect(coversOf(catalog, '2024')).toEqual(['2024/02 Trip/z.jpg']);

  // A folder before it that comes to have photos lends them instead.
  catalog.write([{ listed: [entry('2024/01 Empty/c.jpg')] }]);
  expect(coversOf(catalog, '2024')).toEqual(['2024/01 Empty/c.jpg']);

  // And once the photos all go, the next folder lends.
  catalog.write([{ removed: ['2024/01 Empty/c.jpg', '2024/02 Trip'] }]);
  expect(coversOf(catalog, '2024')).toEqual(['2024/03 Home/b.jpg']);
});

test('covers are passed up only as far as they change, and the tree hears of the folders whose tiles did', () => {
  const catalog = openCatalog();
  catalog.write([
    {
      listed: [
        entry('A'),
        entry('A/own.jpg'),
        entry('A/B'),
        entry('A/B/C'),
        ...['1', '2', '3', '4'].map((name) => entry(`A/B/C/${name}.jpg`)),
      ],
    },
  ]);
  // A fifth photo after the four covers changes C's tile not at all.
  expect(catalog.write([{ listed: [entry('A/B/C/9.jpg')] }]).tiles).toEqual([]);
  // One before them changes C's covers, and B's, which borrows them, but not A's, its own.
  const changed = catalog.write([{ listed: [entry('A/B/C/0.jpg')] }]);
  expect(changed.tiles).toEqual(['A/B/C', 'A/B']);
  expect(coversOf(catalog, 'A')).toEqual(['A/own.jpg']);
  expect(coversOf(catalog, 'A/B')?.[0]).toBe('A/B/C/0.jpg');

  // A cover whose file is replaced is the same entry, but its thumbnail changed.
  const replaced = entry('A/B/C/0.jpg', { metadata: changedAt(5000) });
  expect(catalog.write([{ listed: [replaced] }]).tiles).toEqual(['A/B/C', 'A/B']);
  // Details change no tile.
  expect(catalog.write([{ recalled: [] }]).tiles).toEqual([]);
});

test("the library's row keeps the library's folder's tile, and the tree hears of it as it changes", () => {
  const catalog = openCatalog();
  catalog.write([{ listed: [entry('A'), entry('A/a.jpg')] }]);
  // It borrows A's covers, as any folder with none of its own does.
  function covers() {
    const numbers = librarySummary(catalog.db, catalog.library)?.covers ?? [];
    return [...entriesByNumber(catalog.db, numbers).values()].map((cover) => cover.id);
  }
  expect(covers()).toEqual(['A/a.jpg']);
  // A photo of its own, which only the library's folder holds, is its cover then.
  expect(catalog.write([{ listed: [entry('own.jpg')] }]).tiles).toEqual(['.']);
  expect(covers()).toEqual(['own.jpg']);
});

test('the tree hears of a folder once it is read to the end, as its row shows, though its tile is the same', () => {
  const catalog = openCatalog();
  catalog.write([{ listed: [entry('A'), entry('A/B'), entry('A/B/a.jpg')] }]);
  // Only the first time, and with no folder holding it to list again.
  expect(catalog.write([{ indexed: 'A/B' }])).toMatchObject({ folders: [], tiles: ['A/B'] });
  expect(catalog.write([{ indexed: 'A/B' }]).tiles).toEqual([]);
  // The library's folder, which no folder holds, too.
  expect(catalog.write([{ indexed: '.' }]).tiles).toEqual(['.']);
  expect(catalog.write([{ indexed: '.' }]).tiles).toEqual([]);
});

test('the queries behind tiles each read through an index, never the whole library', () => {
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
  const db = catalogDatabase(database);
  summaryAt(db, 1, 'Trips');
  storeSummary(db, 1, 'Trips', { covers: [], hasEntries: false, hasSubfolders: false });
  firstLenderCovers(db, 1, 'Trips');
  tilesAt(db, 1, ['Trips']);
  coverFiles(db, [1, 2]);
  // A query Drizzle runs from `sql` is prepared twice, so plans repeat.
  const used = new Set(plans);
  for (const index of [
    /^SEARCH items USING INDEX items_id \(library=\? AND id=\?\)$/u,
    // The first folder by name with covers, with nothing to sort, so the read stops there.
    /^SEARCH items USING INDEX items_lenders \(library=\? AND parent_id=\?\)$/u,
    /SEARCH indexed_folders USING PRIMARY KEY/u,
    /^SEARCH items USING INTEGER PRIMARY KEY \(rowid=\?\)/u,
  ]) {
    expect([...used].some((plan) => index.test(plan))).toBe(true);
  }
  for (const plan of plans) {
    expect(plan).not.toMatch(/^SCAN items\b/mu);
  }
});
