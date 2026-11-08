import {
  changedAt,
  details,
  entry,
  openDatabase,
  openStore,
  spec,
} from '#photos/__tests__/catalog-fixtures';
import { nameKey, pruneCatalog } from '#photos/catalog-schema';
import { CatalogViews } from '#photos/catalog-views';
import { DetailsQueue } from '#photos/details-queue';
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
  const store = openStore();
  store.write([{ listed: [entry('a.jpg')] }]);
  store.write([{ details: [details('a.jpg', { camera: 'Canon', tags: ['Beach'] })] }]);
  expect(store.queries.tagged(['Beach'])).toHaveLength(1);

  // Listed again as it was: the details stay.
  expect(store.write([{ listed: [entry('a.jpg')] }]).unread).toEqual([]);
  expect(store.queries.rows(store.queries.tagged(['Beach']))[0]?.exif?.camera).toBe('Canon');

  const changed = entry('a.jpg', {
    metadata: changedAt(2000),
  });
  expect(store.write([{ listed: [changed] }]).unread).toHaveLength(1);
  expect(store.queries.tagged(['Beach'])).toEqual([]);
  expect(store.known(['a.jpg'])).toEqual([
    { id: 'a.jpg', kind: 'image', modifiedMs: 2000, size: 50 },
  ]);
});

test('details read before a file changed are left out', () => {
  const store = openStore();
  store.write([{ listed: [entry('a.jpg')] }]);
  const { missed } = store.write([{ details: [details('a.jpg', { camera: 'Canon' }, 51)] }]);
  expect(missed).toEqual([store.itemOf('a.jpg')]);
  expect(store.queries.unread({ directoryId: '.', recursive: true })).toBe(1);
});

test('removing a folder removes everything inside it, and no other folder', () => {
  const store = openStore();
  store.write([
    { listed: [entry('a'), entry('a/b'), entry('a/b/c.jpg'), entry('a/d.jpg'), entry('ab.jpg')] },
    { indexed: 'a' },
    { indexed: 'a/b' },
  ]);
  store.write([{ removed: ['a'] }]);
  expect(store.known(['a', 'a/b', 'a/b/c.jpg', 'a/d.jpg', 'ab.jpg']).map(({ id }) => id)).toEqual([
    'ab.jpg',
  ]);
  expect(store.isIndexed('a')).toBe(false);
  expect(store.isIndexed('a/b')).toBe(false);
});

test('pruning drops the libraries used longest ago, never the one opened', () => {
  const database = openDatabase();
  for (const [index, root] of ['/old', '/recent', '/open'].entries()) {
    const store = openStore(root, database);
    store.write([{ listed: [entry('a.jpg'), entry('b.jpg'), entry('c.jpg')] }]);
    database.prepare('UPDATE libraries SET used_ms = ? WHERE root = ?').run(index, root);
  }
  pruneCatalog(database, '/open', 4);
  const roots = database.prepare('SELECT root FROM libraries ORDER BY root').all();
  expect(roots.map((row) => row.root)).toEqual(['/open', '/recent']);
  expect(database.prepare('SELECT count(*) AS count FROM items').get()?.count).toBe(6);

  // However large it is, the library being opened stays.
  pruneCatalog(database, '/open', 0);
  expect(database.prepare('SELECT root FROM libraries').all()).toEqual([{ root: '/open' }]);
});

test('details are read for what the window shows, then the view, then the library', () => {
  const store = openStore();
  store.write([
    {
      listed: [
        ...Array.from({ length: 6 }, (_photo, index) => entry(`a/${index}.jpg`)),
        entry('b/library.jpg'),
      ],
    },
  ]);
  const views = new CatalogViews(store);
  const queue = new DetailsQueue(store.queries);
  const { version } = views.open('view', spec({ directoryId: 'a' }));
  views.rows('view', version, 4, 2);
  const ids = (limit: number) => queue.next(limit, views.byUse()).map(({ id }) => id);
  expect(ids(2)).toEqual(['a/4.jpg', 'a/5.jpg']);
  expect(ids(4).slice(2)).toEqual(['a/0.jpg', 'a/1.jpg']);
  expect(ids(10)).toHaveLength(7);
  expect(ids(10).at(-1)).toBe('b/library.jpg');

  // Photos that could not be read wait for a read that lists them afresh.
  const unreadable = store.itemOf('a/4.jpg') ?? 0;
  queue.markUnreadable([unreadable]);
  expect(ids(10)).not.toContain('a/4.jpg');
  queue.markReadable([unreadable]);
  expect(ids(1)).toEqual(['a/4.jpg']);
});

test('the library is looked through once, then again from the start', () => {
  const store = openStore();
  store.write([{ listed: ['a.jpg', 'b.jpg', 'c.jpg'].map((id) => entry(id)) }]);
  const queue = new DetailsQueue(store.queries);
  expect(queue.next(2, []).map(({ id }) => id)).toEqual(['a.jpg', 'b.jpg']);
  store.write([{ details: [details('a.jpg', {}), details('b.jpg', {})] }]);
  expect(queue.next(2, []).map(({ id }) => id)).toEqual(['c.jpg']);
  store.write([{ details: [details('c.jpg', {})] }]);
  expect(queue.next(2, [])).toEqual([]);

  // A file that changed is read again, though the library was looked through past it.
  store.write([{ listed: [entry('a.jpg', { metadata: changedAt(9, 1) })] }]);
  expect(queue.next(2, []).map(({ id }) => id)).toEqual(['a.jpg']);
});
