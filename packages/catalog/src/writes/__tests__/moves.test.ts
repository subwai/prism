import { details, entry, openCatalog, openView } from '#__tests__/fixtures';
import { parentKey } from '#data/codes';
import { tagged } from '#data/filters';
import { folderStamp, isIndexed } from '#data/indexed-folders';
import { entries, itemOf, known } from '#data/items';
import { folders } from '#index-schema';
import { Catalog } from '#threads/client';
import { tileOf } from '#tree/refresh-summaries';
import { moveInCatalog } from '#writes/moves';
import path from 'node:path';
import { expect, onTestFinished, test } from 'vitest';

const STAMP = { changedMs: 2000, inode: '42', modifiedMs: 1000 };

/** A library holding `Trips/Rome`, a folder of photos and folders, read to the end. */
function withRome() {
  const catalog = openCatalog();
  catalog.write([
    {
      listed: [
        entry('Holidays'),
        entry('Trips'),
        entry('Trips/c.jpg'),
        entry('Trips/Rome'),
        entry('Trips/Rome/a.jpg'),
        entry('Trips/Rome/Day 1'),
        entry('Trips/Rome/Day 1/b.jpg'),
      ],
    },
    { indexed: 'Trips/Rome' },
    { readMs: 1000, stamp: STAMP, stamped: 'Trips/Rome' },
    { indexed: 'Trips/Rome/Day 1' },
    { details: [details('Trips/Rome/a.jpg', { tags: ['Beach'] })] },
  ]);
  return catalog;
}

test('moves a folder and everything inside it in place, every entry keeping its number', () => {
  const catalog = withRome();
  const { db, library } = catalog;
  const inside = ['Trips/Rome', 'Trips/Rome/a.jpg', 'Trips/Rome/Day 1', 'Trips/Rome/Day 1/b.jpg'];
  const numbers = inside.map((id) => itemOf(db, library, id));

  const written = moveInCatalog(db, library, 'Trips/Rome', 'Holidays/Roma');

  const moved = inside.map((id) => `Holidays/Roma${id.slice('Trips/Rome'.length)}`);
  expect(moved.map((id) => itemOf(db, library, id))).toEqual(numbers);
  expect(known(db, library, inside)).toEqual([]);
  // Each folder's key sorts it by its new path, as one read there would.
  const keys = db.select({ key: folders.key, path: folders.path }).from(folders).all();
  for (const id of ['Holidays/Roma', 'Holidays/Roma/Day 1']) {
    expect(keys.find((row) => row.path === id)?.key).toBe(parentKey(id));
  }
  // Its details and tags, kept by its number, stay with it.
  const [photo] = entries(db, [numbers[1] ?? 0]);
  expect(photo).toMatchObject({ exif: { tags: ['Beach'] }, id: 'Holidays/Roma/a.jpg' });
  expect(tagged(db, library, ['Beach'])).toEqual([numbers[1]]);
  // So does what its reads found: the walk at launch need not read it again.
  expect(folderStamp(db, library, 'Holidays/Roma')).toEqual(STAMP);
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
  expect(written?.reshaped).toBe(true);
  expect(openView(catalog, { directoryId: 'Holidays/Roma', recursive: true, show: 'all' })).toEqual(
    ['Holidays/Roma/Day 1', 'Holidays/Roma/a.jpg', 'Holidays/Roma/Day 1/b.jpg'],
  );
});

test('renames a file in place, its folder showing it under its new name', () => {
  const catalog = withRome();
  const { db, library } = catalog;
  const number = itemOf(db, library, 'Trips/c.jpg');
  const written = moveInCatalog(db, library, 'Trips/c.jpg', 'Trips/beach.jpg');
  expect(itemOf(db, library, 'Trips/beach.jpg')).toBe(number);
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
  catalog.write([{ listed: [entry('Elsewhere/d.jpg')] }]);
  expect(moveInCatalog(db, library, 'Trips/Rome', to)).toBeNull();
  expect(known(db, library, ['Trips/Rome', 'Trips/Rome/a.jpg'])).toHaveLength(2);
  expect(isIndexed(db, library, 'Trips/Rome')).toBe(true);
});

test('moves nothing the catalog does not have', () => {
  const { db, library } = withRome();
  expect(moveInCatalog(db, library, 'Trips/Paris', 'Trips/Lyon')).toBeNull();
  expect(known(db, library, ['Trips/Lyon'])).toEqual([]);
});

test("the writer moves an entry's kept ratings, and everything's inside it, with its rows", async () => {
  const catalog = Catalog.inProcess({ index: ':memory:', ratings: ':memory:' }, '/library');
  onTestFinished(() => catalog.close());
  const news: string[] = [];
  catalog.onFoldersChanged((told) => news.push(...told.folders));
  catalog.write({
    listed: [entry('Trips'), entry('Trips/Rome'), entry('Trips/Rome/clip.mov', { kind: 'video' })],
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
  catalog.write({ listed: [entry('Trips/Rome')] });
  await expect(catalog.call('move', 'Trips/Roma', 'Trips/Rome')).resolves.toBe(false);
  const listed = await catalog.call('entriesIn', 'Trips');
  expect(listed.map(({ id, rating }) => [id, rating])).toEqual([
    ['Trips/Roma', undefined],
    ['Trips/Rome', 4],
  ]);
});
