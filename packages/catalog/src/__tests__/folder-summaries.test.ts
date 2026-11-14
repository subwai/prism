import { changedAt, entry, openCatalog, openDatabase, type TestCatalog } from '#__tests__/fixtures';
import { catalogDatabase } from '#data/database';
import {
  coverFiles,
  storeSummary,
  subfolderCovers,
  summaryAt,
  tilesAt,
  uncoveredFolders,
} from '#data/folder-summaries';
import { fillSummaries, withSummaries } from '#folder-summaries';
import { migrateIndex } from '#index-migrations';
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

test('covers are passed up only as far as they change, and the tree hears of the folders holding those that did', () => {
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
  expect(catalog.write([{ listed: [entry('A/B/C/9.jpg')] }]).folders).toEqual([]);
  // One before them changes C's covers, and B's, which borrows them, but not A's, its own.
  const changed = catalog.write([{ listed: [entry('A/B/C/0.jpg')] }]);
  expect(changed.folders.toSorted()).toEqual(['A', 'A/B']);
  expect(coversOf(catalog, 'A')).toEqual(['A/own.jpg']);
  expect(coversOf(catalog, 'A/B')?.[0]).toBe('A/B/C/0.jpg');

  // A cover whose file is replaced is the same entry, but its thumbnail changed.
  const replaced = entry('A/B/C/0.jpg', { metadata: changedAt(5000) });
  expect(catalog.write([{ listed: [replaced] }]).folders.toSorted()).toEqual(['A', 'A/B']);
  // Details change no tile.
  expect(catalog.write([{ recalled: [] }]).folders).toEqual([]);
});

test("a catalog a build before tiles wrote shows every folder's covers, and fills them in", () => {
  const database = openDatabase();
  const catalog = openCatalog('/library', database);
  catalog.write([
    {
      listed: [
        entry('A'),
        entry('A/B'),
        entry('A/B/a.jpg'),
        entry('C'),
        entry('C/c.jpg'),
        entry('D'),
      ],
    },
  ]);
  const before = ['A', 'A/B', 'C', 'D'].map((id) => tileOf(catalog, id));
  // The table as the build before tiles left it, and the migration applied to it.
  database.exec(`DROP INDEX items_uncovered;
    ALTER TABLE items DROP COLUMN covers;
    ALTER TABLE items DROP COLUMN has_entries;
    ALTER TABLE items DROP COLUMN has_subfolders;
    DELETE FROM __drizzle_migrations WHERE name LIKE '%_folder-covers';`);
  migrateIndex(database);
  expect(uncoveredFolders(catalog.db, catalog.library, 10)).toHaveLength(4);
  // A read works them out until the writer has.
  expect(['A', 'A/B', 'C', 'D'].map((id) => tileOf(catalog, id))).toEqual(before);

  // The writer fills them in, a batch at a time, deepest first, and says where.
  expect(fillSummaries(catalog.db, catalog.library, 2)).toEqual({ found: 2, holding: ['.'] });
  expect(fillSummaries(catalog.db, catalog.library, 2).found).toBe(2);
  expect(fillSummaries(catalog.db, catalog.library, 2)).toEqual({ found: 0, holding: [] });
  for (const id of ['A', 'A/B', 'C', 'D']) {
    expect(summaryAt(catalog.db, catalog.library, id)?.summary).not.toBeNull();
  }
  expect(['A', 'A/B', 'C', 'D'].map((id) => tileOf(catalog, id))).toEqual(before);
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
  subfolderCovers(db, 1, 'Trips');
  uncoveredFolders(db, 1, 10);
  tilesAt(db, 1, ['Trips']);
  coverFiles(db, [1, 2]);
  // A query Drizzle runs from `sql` is prepared twice, so plans repeat.
  const used = new Set(plans);
  for (const index of [
    /^SEARCH items USING INDEX items_id \(library=\? AND id=\?\)$/u,
    /^SEARCH items USING INDEX items_parent \(library=\? AND parent_id=\?\)/u,
    /^SEARCH items USING INDEX items_uncovered \(library=\?\)$/u,
    /SEARCH indexed_folders USING PRIMARY KEY/u,
    /^SEARCH items USING INTEGER PRIMARY KEY \(rowid=\?\)/u,
  ]) {
    expect([...used].some((plan) => index.test(plan))).toBe(true);
  }
  for (const plan of plans) {
    expect(plan).not.toMatch(/^SCAN items\b/mu);
  }
});
