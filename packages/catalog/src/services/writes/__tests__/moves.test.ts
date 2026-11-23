import { details, entry, openCatalog, openView } from '#__tests__/fixtures';
import { folders } from '#database/photo-index/schema';
import { catalogEntriesAt, entriesInOrder, entryNumberOf } from '#repositories/entries/entries';
import { photosTagged } from '#repositories/entry-tags';
import { folderTimes, isIndexed } from '#repositories/indexed-folders';
import { parentKey } from '#repositories/queries/codes';
import { tileOf } from '#services/tree/read-summaries';
import { moveInCatalog } from '#services/writes/moves';
import { Catalog } from '#threads/client';
import path from 'node:path';
import { expect, onTestFinished, test } from 'vitest';

const TIMES = { changedMs: 2000, inode: '42', modifiedMs: 1000 };

/** A library holding `Trips/Rome`, a folder of photos and folders, read to the end. */
function withRome() {
  const catalog = openCatalog();
  catalog.write([
    {
      entries: [
        entry('Holidays'),
        entry('Trips'),
        entry('Trips/c.jpg'),
        entry('Trips/Rome'),
        entry('Trips/Rome/a.jpg'),
        entry('Trips/Rome/Day 1'),
        entry('Trips/Rome/Day 1/b.jpg'),
      ],
      kind: 'list',
    },
    { folderId: 'Trips/Rome', kind: 'markIndexed' },
    { folderId: 'Trips/Rome', kind: 'folder-times', readMs: 1000, times: TIMES },
    { folderId: 'Trips/Rome/Day 1', kind: 'markIndexed' },
    { details: [details('Trips/Rome/a.jpg', { tags: ['Beach'] })], kind: 'storeDetails' },
  ]);
  return catalog;
}

test('moves a folder and everything inside it in place, every entry keeping its number', () => {
  const catalog = withRome();
  const { db, library } = catalog;
  const inside = ['Trips/Rome', 'Trips/Rome/a.jpg', 'Trips/Rome/Day 1', 'Trips/Rome/Day 1/b.jpg'];
  const numbers = inside.map((id) => entryNumberOf(db, library, id));

  const written = moveInCatalog(db, library, 'Trips/Rome', 'Holidays/Roma');

  const moved = inside.map((id) => `Holidays/Roma${id.slice('Trips/Rome'.length)}`);
  expect(moved.map((id) => entryNumberOf(db, library, id))).toEqual(numbers);
  expect(catalogEntriesAt(db, library, inside)).toEqual([]);
  // Each folder's key sorts it by its new path, as one read there would.
  const keys = db.select({ key: folders.key, path: folders.path }).from(folders).all();
  for (const id of ['Holidays/Roma', 'Holidays/Roma/Day 1']) {
    expect(keys.find((row) => row.path === id)?.key).toBe(parentKey(id));
  }
  // Its details and tags, kept by its number, stay with it.
  const [photo] = entriesInOrder(db, [numbers[1] ?? 0]);
  expect(photo).toMatchObject({ exif: { tags: ['Beach'] }, id: 'Holidays/Roma/a.jpg' });
  expect(photosTagged(db, library, ['Beach'])).toEqual([numbers[1]]);
  // So does what its reads found: the walk at launch need not read it again.
  expect(folderTimes(db, library, 'Holidays/Roma')).toEqual(TIMES);
  expect(isIndexed(db, library, 'Holidays/Roma/Day 1')).toBe(true);
  expect(isIndexed(db, library, 'Trips/Rome')).toBe(false);
  // The folder it went to borrows its covers, and the tree reads every moved folder again.
  expect(tileOf(db, library, 'Holidays')?.covers).toEqual([numbers[1]]);
  expect(written?.tiles).toContain('Holidays');
  expect(written?.folders.toSorted()).toEqual([
    'Holidays',
    'Holidays/Roma',
    'Holidays/Roma/Day 1',
    'Trips',
  ]);
  expect(written?.treeChanged).toBe(true);
  expect(openView(catalog, { directoryId: 'Holidays/Roma', recursive: true, show: 'all' })).toEqual(
    ['Holidays/Roma/Day 1', 'Holidays/Roma/a.jpg', 'Holidays/Roma/Day 1/b.jpg'],
  );
});

test('renames a file in place, its folder showing it under its new name', () => {
  const catalog = withRome();
  const { db, library } = catalog;
  const number = entryNumberOf(db, library, 'Trips/c.jpg');
  const written = moveInCatalog(db, library, 'Trips/c.jpg', 'Trips/beach.jpg');
  expect(entryNumberOf(db, library, 'Trips/beach.jpg')).toBe(number);
  // Its folder's cover shows it by its ID, so the tile is read again.
  expect(written?.tiles).toContain('Trips');
  expect(openView(catalog, { directoryId: 'Trips' })).toEqual(['Trips/Rome', 'Trips/beach.jpg']);
});

test.each([
  ['an entry the catalog has there already', 'Trips/c.jpg'],
  ['a folder an entry is in, with no row of its own yet', 'Elsewhere'],
  ['a folder inside the one moved', 'Trips/Rome/Day 1/Rome'],
])('moves nothing into %s', (_case, to) => {
  const catalog = withRome();
  const { db, library } = catalog;
  catalog.write([{ entries: [entry('Elsewhere/d.jpg')], kind: 'list' }]);
  expect(moveInCatalog(db, library, 'Trips/Rome', to)).toBeNull();
  expect(catalogEntriesAt(db, library, ['Trips/Rome', 'Trips/Rome/a.jpg'])).toHaveLength(2);
  expect(isIndexed(db, library, 'Trips/Rome')).toBe(true);
});

test('moves nothing the catalog does not have', () => {
  const { db, library } = withRome();
  expect(moveInCatalog(db, library, 'Trips/Paris', 'Trips/Lyon')).toBeNull();
  expect(catalogEntriesAt(db, library, ['Trips/Lyon'])).toEqual([]);
});

test("the writer moves an entry's kept ratings, and everything's inside it, with its rows", async () => {
  const catalog = Catalog.inProcess({ index: ':memory:', ratings: ':memory:' }, '/library');
  onTestFinished(() => catalog.close());
  const news: string[] = [];
  catalog.onFoldersChanged((told) => news.push(...told.folders));
  catalog.write({
    entries: [entry('Trips'), entry('Trips/Rome'), entry('Trips/Rome/clip.mov', { kind: 'video' })],
    kind: 'list',
  });
  await catalog.call('rate', 'Trips/Rome', 4);
  await catalog.call('rate', 'Trips/Rome/clip.mov', 3);

  await expect(catalog.call('move', 'Trips/Rome', 'Trips/Roma')).resolves.toBe(true);
  const [folder] = await catalog.call('entriesIn', 'Trips');
  expect(folder).toMatchObject({ id: 'Trips/Roma', rating: 4 });
  const [clip] = await catalog.call('entriesIn', 'Trips/Roma');
  expect(clip).toMatchObject({ id: path.join('Trips/Roma', 'clip.mov'), rating: 3 });
  expect(news).toContain('Trips/Roma');

  // A move the catalog cannot make still takes the ratings along.
  catalog.write({ entries: [entry('Trips/Rome')], kind: 'list' });
  await expect(catalog.call('move', 'Trips/Roma', 'Trips/Rome')).resolves.toBe(false);
  const listed = await catalog.call('entriesIn', 'Trips');
  expect(listed.map(({ id, rating }) => [id, rating])).toEqual([
    ['Trips/Roma', undefined],
    ['Trips/Rome', 4],
  ]);
});
