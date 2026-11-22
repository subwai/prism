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
    {
      entries: ['b.jpg', 'a', 'c.mov', 'a.jpg', 'z', 'notes.txt'].map((id) => entry(id)),
      kind: 'list',
    },
  ]);
  catalog.write([
    {
      entries: [entry('c.mov', { kind: 'video' }), entry('notes.txt', { kind: 'file' })],
      kind: 'list',
    },
  ]);
  expect(openView(catalog)).toEqual(['a', 'z', 'a.jpg', 'b.jpg', 'c.mov']);
  expect(openView(catalog, { descending: true })).toEqual(['z', 'a', 'c.mov', 'b.jpg', 'a.jpg']);
  expect(openView(catalog, { show: 'media' })).toEqual(['a.jpg', 'b.jpg', 'c.mov']);
  expect(openView(catalog, { show: 'images' })).toEqual(['a.jpg', 'b.jpg']);
});

test('views count the files of their folders that no view shows, whatever narrows them', () => {
  const catalog = openCatalog();
  catalog.write([
    {
      entries: [
        entry('a'),
        entry('a/b.jpg'),
        entry('a/notes.txt', { kind: 'file' }),
        entry('c.jpg'),
        entry('d.psd', { kind: 'file' }),
      ],
      kind: 'list',
    },
  ]);
  const views = catalog.views();
  expect(views.openNow('folder', spec())).toMatchObject({ count: 2, unsupported: 1 });
  expect(views.openNow('search', spec({ search: 'nothing' }))).toMatchObject({
    count: 0,
    unsupported: 1,
  });
  expect(views.openNow('images', spec({ show: 'images' }))).toMatchObject({ unsupported: 1 });
  expect(views.openNow('everything', spec({ recursive: true }))).toMatchObject({ unsupported: 2 });
  expect(views.openNow('inside', spec({ directoryId: 'a' }))).toMatchObject({ unsupported: 1 });
});

test('the sort by date taken falls back to when files changed', () => {
  const catalog = openCatalog();
  catalog.write([
    {
      entries: [
        entry('early.jpg', { metadata: changedAt(3000) }),
        entry('late.jpg', { metadata: changedAt(1000) }),
        entry('unread.jpg', { metadata: changedAt(2000) }),
      ],
      kind: 'list',
    },
    {
      details: [
        details('early.jpg', { takenMs: 500 }, 50, 3000),
        details('late.jpg', { takenMs: 4000 }, 50, 1000),
      ],
      kind: 'storeDetails',
    },
  ]);
  expect(openView(catalog, { sort: 'taken' })).toEqual(['early.jpg', 'unread.jpg', 'late.jpg']);
});

test('recursive views hold everything inside their folder', () => {
  const catalog = openCatalog();
  catalog.write([
    {
      entries: ['a', 'a/b', 'a/b/c.jpg', 'a/d.jpg', 'ab.jpg', 'e.jpg'].map((id) => entry(id)),
      kind: 'list',
    },
  ]);
  expect(openView(catalog, { directoryId: 'a', recursive: true })).toEqual([
    'a/b',
    'a/d.jpg',
    'a/b/c.jpg',
  ]);
  expect(openView(catalog, { recursive: true, show: 'media' })).toEqual([
    'ab.jpg',
    'e.jpg',
    'a/d.jpg',
    'a/b/c.jpg',
  ]);
});

test("the sort by name keeps each folder's entries together, folder by folder", () => {
  const catalog = openCatalog();
  const folders = ['a', 'a b', 'a/b', '9', '10'];
  const photos = ['a/2.jpg', 'a/b/1.jpg', 'a b/1.jpg', '1.jpg', '10/1.jpg', '9/1.jpg', 'a/1.jpg'];
  catalog.write([{ entries: [...folders, ...photos].map((id) => entry(id)), kind: 'list' }]);
  expect(openView(catalog, { recursive: true, show: 'media' })).toEqual([
    '1.jpg',
    '9/1.jpg',
    '10/1.jpg',
    'a/1.jpg',
    'a/2.jpg',
    'a/b/1.jpg',
    'a b/1.jpg',
  ]);
});

test('filters and searches narrow a view, and facets count its whole scope', () => {
  const catalog = openCatalog();
  catalog.write([
    {
      entries: [
        entry('beach.jpg'),
        entry('city.jpg'),
        entry('dunes.jpg'),
        entry('clip.mov', { kind: 'video' }),
        entry('Beaches'),
      ],
      kind: 'list',
    },
    {
      details: [
        details('beach.jpg', { camera: 'Canon', lens: '35mm', tags: ['Holiday'] }),
        details('city.jpg', { camera: 'Nikon', tags: ['Holiday', 'Night'] }),
        details('dunes.jpg', { camera: 'Canon', tags: ['Sand'] }),
      ],
      kind: 'storeDetails',
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
  views.openNow('view', spec(filtered({ camera: ['Nikon'] })));
  expect(views.facets('view')).toEqual({
    camera: [
      { count: 2, value: 'Canon' },
      { count: 1, value: 'Nikon' },
    ],
    format: [
      { count: 3, value: 'Photo' },
      { count: 1, value: 'Video' },
    ],
    lens: [{ count: 1, value: '35mm' }],
    // Nothing is rated, the folder included.
    rating: [{ count: 5, value: 'unrated' }],
    tag: [
      { count: 2, value: 'Holiday' },
      { count: 1, value: 'Night' },
      { count: 1, value: 'Sand' },
    ],
  });
});

test('a view keeps its last version answering while rows arrive', () => {
  const catalog = openCatalog();
  catalog.write([{ entries: [entry('b.jpg')], kind: 'list' }]);
  const views = catalog.views();
  const first = views.openNow('view', spec());
  expect(first).toMatchObject({ count: 1, unread: 1 });
  expect(views.stale(catalog.generation())).toEqual([]);

  catalog.write([{ entries: [entry('a.jpg'), entry('c.jpg')], kind: 'list' }]);
  expect(views.stale(catalog.generation())).toEqual(['view']);
  const second = views.refreshNow('view');
  expect(second).toMatchObject({ count: 3, unread: 3 });
  expect(shown(views, 'view', second?.version ?? 0)).toEqual(['a.jpg', 'b.jpg', 'c.jpg']);
  expect(shown(views, 'view', first.version)).toEqual(['b.jpg']);
  expect(views.indexOf('view', first.version, 'b.jpg')).toBe(0);
  expect(views.indexOf('view', second?.version ?? 0, 'b.jpg')).toBe(1);

  // Rows of a removed entry are left out of the version that still holds it.
  catalog.write([{ ids: ['b.jpg'], kind: 'remove' }]);
  const third = views.refreshNow('view');
  expect(shown(views, 'view', second?.version ?? 0)).toEqual(['a.jpg', 'c.jpg']);
  expect(views.rows('view', first.version, 0, 1)).toBeNull();
  // A version that has gone says so, rather than that the entry is not in it.
  expect(views.indexOf('view', first.version, 'a.jpg')).toBeNull();
  expect(views.indexOf('view', third?.version ?? 0, 'b.jpg')).toBe(-1);
  expect(third?.count).toBe(2);
});

test("a view's files are listed in its order with folders' covers, without counting as shown", () => {
  const catalog = openCatalog();
  catalog.write([
    { entries: [entry('b.jpg'), entry('a'), entry('a.jpg'), entry('a/x.jpg')], kind: 'list' },
  ]);
  const views = catalog.views();
  const { version } = views.openNow('view', spec());
  const small = views.files('view', 1, 2, 4);
  expect(small).toMatchObject({ start: 0, whole: true });
  expect(small?.files.map(({ id, cover }) => [id, cover?.id])).toEqual([
    ['a', 'a/x.jpg'],
    ['a.jpg', undefined],
    ['b.jpg', undefined],
  ]);
  expect(views.byUse()[0]?.shown).toEqual([]);
  expect(views.rows('view', version, 0, 0)).toEqual([]);
  // A view of the limit or more reads only the rows asked for.
  const large = views.files('view', 1, 2, 3);
  expect(large).toMatchObject({ start: 1, whole: false });
  expect(large?.files.map(({ id }) => id)).toEqual(['a.jpg']);
  views.close('view');
  expect(views.files('view', 0, 1, 4)).toBeNull();
});
