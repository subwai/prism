import {
  changedAt,
  details,
  entry,
  filtered,
  openStore,
  openView,
  shown,
  spec,
} from '#photos/__tests__/catalog-fixtures';
import { CatalogViews } from '#photos/catalog-views';
import { expect, test } from 'vitest';

test('views put folders first, and a descending sort reverses each group', () => {
  const store = openStore();
  store.write([
    { listed: ['b.jpg', 'a', 'c.mov', 'a.jpg', 'z', 'notes.txt'].map((id) => entry(id)) },
  ]);
  store.write([
    { listed: [entry('c.mov', { kind: 'video' }), entry('notes.txt', { kind: 'file' })] },
  ]);
  expect(openView(store)).toEqual(['a', 'z', 'a.jpg', 'b.jpg', 'c.mov']);
  expect(openView(store, { descending: true })).toEqual(['z', 'a', 'c.mov', 'b.jpg', 'a.jpg']);
  expect(openView(store, { show: 'media' })).toEqual(['a.jpg', 'b.jpg', 'c.mov']);
  expect(openView(store, { show: 'images' })).toEqual(['a.jpg', 'b.jpg']);
});

test('the sort by date taken falls back to when files changed', () => {
  const store = openStore();
  store.write([
    {
      listed: [
        entry('early.jpg', { metadata: changedAt(3000) }),
        entry('late.jpg', { metadata: changedAt(1000) }),
        entry('unread.jpg', { metadata: changedAt(2000) }),
      ],
    },
    {
      details: [
        details('early.jpg', { takenMs: 500 }, 50, 3000),
        details('late.jpg', { takenMs: 4000 }, 50, 1000),
      ],
    },
  ]);
  expect(openView(store, { sort: 'taken' })).toEqual(['early.jpg', 'unread.jpg', 'late.jpg']);
});

test('recursive views hold everything inside their folder', () => {
  const store = openStore();
  store.write([
    { listed: ['a', 'a/b', 'a/b/c.jpg', 'a/d.jpg', 'ab.jpg', 'e.jpg'].map((id) => entry(id)) },
  ]);
  expect(openView(store, { directoryId: 'a', recursive: true })).toEqual([
    'a/b',
    'a/b/c.jpg',
    'a/d.jpg',
  ]);
  expect(openView(store, { recursive: true, show: 'media' })).toEqual([
    'ab.jpg',
    'a/b/c.jpg',
    'a/d.jpg',
    'e.jpg',
  ]);
});

test('filters and searches narrow a view, and facets count its whole scope', () => {
  const store = openStore();
  store.write([
    {
      listed: [
        entry('beach.jpg'),
        entry('city.jpg'),
        entry('dunes.jpg'),
        entry('clip.mov', { kind: 'video' }),
        entry('Beaches'),
      ],
    },
    {
      details: [
        details('beach.jpg', { camera: 'Canon', lens: '35mm', tags: ['Holiday'] }),
        details('city.jpg', { camera: 'Nikon', tags: ['Holiday', 'Night'] }),
        details('dunes.jpg', { camera: 'Canon', tags: ['Sand'] }),
      ],
    },
  ]);
  expect(openView(store, filtered({ camera: ['Canon'] }))).toEqual(['beach.jpg', 'dunes.jpg']);
  expect(openView(store, filtered({ camera: ['Canon'], tag: ['Holiday'] }))).toEqual(['beach.jpg']);
  expect(openView(store, filtered({ format: ['Video'] }))).toEqual(['clip.mov']);
  expect(openView(store, { search: 'BEACH' })).toEqual(['Beaches', 'beach.jpg']);
  // A search matches photos' tags too.
  expect(openView(store, { search: 'night' })).toEqual(['city.jpg']);

  const views = new CatalogViews(store);
  views.open('view', spec(filtered({ camera: ['Nikon'] })));
  expect(views.facets('view')).toEqual({
    fields: {
      camera: [
        { count: 2, value: 'Canon' },
        { count: 1, value: 'Nikon' },
      ],
      format: [
        { count: 3, value: 'Photo' },
        { count: 1, value: 'Video' },
      ],
      lens: [{ count: 1, value: '35mm' }],
      tag: [
        { count: 2, value: 'Holiday' },
        { count: 1, value: 'Night' },
        { count: 1, value: 'Sand' },
      ],
    },
    unread: 0,
  });
});

test('a view keeps its last version answering while rows arrive', () => {
  const store = openStore();
  store.write([{ listed: [entry('b.jpg')] }]);
  const views = new CatalogViews(store);
  const first = views.open('view', spec());
  expect(first).toMatchObject({ count: 1, unread: 1 });
  expect(views.stale()).toEqual([]);

  store.write([{ listed: [entry('a.jpg'), entry('c.jpg')] }]);
  expect(views.stale()).toEqual(['view']);
  const second = views.refresh('view');
  expect(second).toMatchObject({ count: 3, unread: 3 });
  expect(shown(views, 'view', second?.version ?? 0)).toEqual(['a.jpg', 'b.jpg', 'c.jpg']);
  expect(shown(views, 'view', first.version)).toEqual(['b.jpg']);
  expect(views.indexOf('view', first.version, 'b.jpg')).toBe(0);
  expect(views.indexOf('view', second?.version ?? 0, 'b.jpg')).toBe(1);

  // Rows of a removed entry are left out of the version that still holds it.
  store.write([{ removed: ['b.jpg'] }]);
  const third = views.refresh('view');
  expect(shown(views, 'view', second?.version ?? 0)).toEqual(['a.jpg', 'c.jpg']);
  expect(views.rows('view', first.version, 0, 1)).toBeNull();
  expect(third?.count).toBe(2);
});
