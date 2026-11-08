import { changedAt, details, entry, openCatalog, openDatabase, spec } from '#__tests__/fixtures';
import { nameKey } from '#data/codes';
import { catalogDatabase } from '#data/database';
import { countUnread } from '#data/details';
import { tagged } from '#data/filters';
import { isIndexed } from '#data/indexed-folders';
import { entries, itemOf, known } from '#data/items';
import { createDetailsQueue } from '#details-queue';
import { pruneCatalog } from '#pruning';
import { expect, test } from 'vitest';

test('names sort as people read them', () => {
  const names = ['IMG_10.jpg', 'img_9.jpg', 'Élan.jpg', 'elan2.jpg', 'IMG_009b.jpg', 'b.jpg'];
  expect(names.toSorted((left, right) => (nameKey(left) < nameKey(right) ? -1 : 1))).toEqual([
    'b.jpg',
    'Élan.jpg',
    'elan2.jpg',
    'img_9.jpg',
    'IMG_009b.jpg',
    'IMG_10.jpg',
  ]);
});

test('a listing of a file that changed drops its details and tags', () => {
  const catalog = openCatalog();
  catalog.write([{ listed: [entry('a.jpg')] }]);
  catalog.write([{ details: [details('a.jpg', { camera: 'Canon', tags: ['Beach'] })] }]);
  expect(tagged(catalog.db, catalog.library, ['Beach'])).toHaveLength(1);

  // Listed again as it was: the details stay.
  expect(catalog.write([{ listed: [entry('a.jpg')] }]).unread).toEqual([]);
  expect(entries(catalog.db, tagged(catalog.db, catalog.library, ['Beach']))[0]?.exif?.camera).toBe(
    'Canon',
  );

  const changed = entry('a.jpg', {
    metadata: changedAt(2000),
  });
  expect(catalog.write([{ listed: [changed] }]).unread).toHaveLength(1);
  expect(tagged(catalog.db, catalog.library, ['Beach'])).toEqual([]);
  expect(known(catalog.db, catalog.library, ['a.jpg'])).toEqual([
    { id: 'a.jpg', kind: 'image', modifiedMs: 2000, size: 50 },
  ]);
});

test('details read before a file changed are left out', () => {
  const catalog = openCatalog();
  catalog.write([{ listed: [entry('a.jpg')] }]);
  const { missed } = catalog.write([{ details: [details('a.jpg', { camera: 'Canon' }, 51)] }]);
  expect(missed).toEqual([itemOf(catalog.db, catalog.library, 'a.jpg')]);
  expect(countUnread(catalog.db, catalog.library, { directoryId: '.', recursive: true })).toBe(1);
});

test('removing a folder removes everything inside it, and no other folder', () => {
  const catalog = openCatalog();
  catalog.write([
    { listed: [entry('a'), entry('a/b'), entry('a/b/c.jpg'), entry('a/d.jpg'), entry('ab.jpg')] },
    { indexed: 'a' },
    { indexed: 'a/b' },
  ]);
  catalog.write([{ removed: ['a'] }]);
  expect(
    known(catalog.db, catalog.library, ['a', 'a/b', 'a/b/c.jpg', 'a/d.jpg', 'ab.jpg']).map(
      ({ id }) => id,
    ),
  ).toEqual(['ab.jpg']);
  expect(isIndexed(catalog.db, catalog.library, 'a')).toBe(false);
  expect(isIndexed(catalog.db, catalog.library, 'a/b')).toBe(false);
});

test('pruning drops the libraries used longest ago, never the one opened', () => {
  const database = openDatabase();
  for (const [index, root] of ['/old', '/recent', '/open'].entries()) {
    const catalog = openCatalog(root, database);
    catalog.write([{ listed: [entry('a.jpg'), entry('b.jpg'), entry('c.jpg')] }]);
    database.prepare('UPDATE libraries SET used_ms = ? WHERE root = ?').run(index, root);
  }
  pruneCatalog(catalogDatabase(database), '/open', 4);
  const roots = database.prepare('SELECT root FROM libraries ORDER BY root').all();
  expect(roots.map((row) => row.root)).toEqual(['/open', '/recent']);
  expect(database.prepare('SELECT count(*) AS count FROM items').get()?.count).toBe(6);

  // However large it is, the library being opened stays.
  pruneCatalog(catalogDatabase(database), '/open', 0);
  expect(database.prepare('SELECT root FROM libraries').all()).toEqual([{ root: '/open' }]);
});

test('details are read for what the window shows, then the view, then the library', () => {
  const catalog = openCatalog();
  catalog.write([
    {
      listed: [
        ...Array.from({ length: 6 }, (_photo, index) => entry(`a/${index}.jpg`)),
        entry('b/library.jpg'),
      ],
    },
  ]);
  const views = catalog.views();
  const queue = createDetailsQueue(catalog.db, catalog.library);
  const { version } = views.open('view', spec({ directoryId: 'a' }));
  views.rows('view', version, 4, 2);
  const ids = (limit: number) => queue.next(limit, views.byUse()).map(({ id }) => id);
  expect(ids(2)).toEqual(['a/4.jpg', 'a/5.jpg']);
  expect(ids(4).slice(2)).toEqual(['a/0.jpg', 'a/1.jpg']);
  expect(ids(10)).toHaveLength(7);
  expect(ids(10).at(-1)).toBe('b/library.jpg');

  // Photos that could not be read wait for a read that lists them afresh.
  const unreadable = itemOf(catalog.db, catalog.library, 'a/4.jpg') ?? 0;
  queue.markUnreadable([unreadable]);
  expect(ids(10)).not.toContain('a/4.jpg');
  queue.markReadable([unreadable]);
  expect(ids(1)).toEqual(['a/4.jpg']);
});

test('the library is looked through once, then again from the start', () => {
  const catalog = openCatalog();
  catalog.write([{ listed: ['a.jpg', 'b.jpg', 'c.jpg'].map((id) => entry(id)) }]);
  const queue = createDetailsQueue(catalog.db, catalog.library);
  expect(queue.next(2, []).map(({ id }) => id)).toEqual(['a.jpg', 'b.jpg']);
  catalog.write([{ details: [details('a.jpg', {}), details('b.jpg', {})] }]);
  expect(queue.next(2, []).map(({ id }) => id)).toEqual(['c.jpg']);
  catalog.write([{ details: [details('c.jpg', {})] }]);
  expect(queue.next(2, [])).toEqual([]);

  // A file that changed is read again, though the library was looked through past it.
  catalog.write([{ listed: [entry('a.jpg', { metadata: changedAt(9, 1) })] }]);
  expect(queue.next(2, []).map(({ id }) => id)).toEqual(['a.jpg']);
});
