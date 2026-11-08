import {
  changedAt,
  details,
  entry,
  filtered,
  openCatalog,
  openView,
  shown,
  spec,
} from '#__tests__/fixtures';
import { expect, test } from 'vitest';

test('views put folders first, and a descending sort reverses each group', () => {
  const catalog = openCatalog();
  catalog.write([
    { listed: ['b.jpg', 'a', 'c.mov', 'a.jpg', 'z', 'notes.txt'].map((id) => entry(id)) },
  ]);
  catalog.write([
    { listed: [entry('c.mov', { kind: 'video' }), entry('notes.txt', { kind: 'file' })] },
  ]);
  expect(openView(catalog)).toEqual(['a', 'z', 'a.jpg', 'b.jpg', 'c.mov']);
  expect(openView(catalog, { descending: true })).toEqual(['z', 'a', 'c.mov', 'b.jpg', 'a.jpg']);
  expect(openView(catalog, { show: 'media' })).toEqual(['a.jpg', 'b.jpg', 'c.mov']);
  expect(openView(catalog, { show: 'images' })).toEqual(['a.jpg', 'b.jpg']);
});

test('the sort by date taken falls back to when files changed', () => {
  const catalog = openCatalog();
  catalog.write([
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
  expect(openView(catalog, { sort: 'taken' })).toEqual(['early.jpg', 'unread.jpg', 'late.jpg']);
});

test('recursive views hold everything inside their folder', () => {
  const catalog = openCatalog();
  catalog.write([
    { listed: ['a', 'a/b', 'a/b/c.jpg', 'a/d.jpg', 'ab.jpg', 'e.jpg'].map((id) => entry(id)) },
  ]);
  expect(openView(catalog, { directoryId: 'a', recursive: true })).toEqual([
    'a/b',
    'a/b/c.jpg',
    'a/d.jpg',
  ]);
  expect(openView(catalog, { recursive: true, show: 'media' })).toEqual([
    'ab.jpg',
    'a/b/c.jpg',
    'a/d.jpg',
    'e.jpg',
  ]);
});

test('filters and searches narrow a view, and facets count its whole scope', () => {
  const catalog = openCatalog();
  catalog.write([
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
  expect(openView(catalog, filtered({ camera: ['Canon'] }))).toEqual(['beach.jpg', 'dunes.jpg']);
  expect(openView(catalog, filtered({ camera: ['Canon'], tag: ['Holiday'] }))).toEqual([
    'beach.jpg',
  ]);
  expect(openView(catalog, filtered({ format: ['Video'] }))).toEqual(['clip.mov']);
  expect(openView(catalog, { search: 'BEACH' })).toEqual(['Beaches', 'beach.jpg']);
  // A search matches photos' tags too.
  expect(openView(catalog, { search: 'night' })).toEqual(['city.jpg']);

  const views = catalog.views();
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
  const catalog = openCatalog();
  catalog.write([{ listed: [entry('b.jpg')] }]);
  const views = catalog.views();
  const first = views.open('view', spec());
  expect(first).toMatchObject({ count: 1, unread: 1 });
  expect(views.stale()).toEqual([]);

  catalog.write([{ listed: [entry('a.jpg'), entry('c.jpg')] }]);
  expect(views.stale()).toEqual(['view']);
  const second = views.refresh('view');
  expect(second).toMatchObject({ count: 3, unread: 3 });
  expect(shown(views, 'view', second?.version ?? 0)).toEqual(['a.jpg', 'b.jpg', 'c.jpg']);
  expect(shown(views, 'view', first.version)).toEqual(['b.jpg']);
  expect(views.indexOf('view', first.version, 'b.jpg')).toBe(0);
  expect(views.indexOf('view', second?.version ?? 0, 'b.jpg')).toBe(1);

  // Rows of a removed entry are left out of the version that still holds it.
  catalog.write([{ removed: ['b.jpg'] }]);
  const third = views.refresh('view');
  expect(shown(views, 'view', second?.version ?? 0)).toEqual(['a.jpg', 'c.jpg']);
  expect(views.rows('view', first.version, 0, 1)).toBeNull();
  expect(third?.count).toBe(2);
});
