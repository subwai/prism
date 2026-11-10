import {
  changedAt,
  details,
  entry,
  filtered,
  openCatalog,
  openView,
  spec,
} from '#__tests__/fixtures';
import { moveStored, rateStored } from '#stored-ratings';
import { expect, test } from 'vitest';

function ratedLibrary() {
  const catalog = openCatalog();
  catalog.write([
    {
      listed: [
        entry('trips'),
        entry('work'),
        entry('beach.jpg'),
        entry('dunes.jpg'),
        entry('sea.jpg'),
        entry('clip.mov', { kind: 'video' }),
      ],
    },
    { details: [details('beach.jpg', { rating: 5 }), details('dunes.jpg', { rating: 2 })] },
  ]);
  rateStored(catalog.stored, 'trips', 4);
  rateStored(catalog.stored, 'clip.mov', 3);
  catalog.touch();
  return catalog;
}

test('rows carry ratings, photos from their files and the rest from the ratings file', () => {
  const catalog = ratedLibrary();
  const views = catalog.views();
  const { version } = views.open('view', spec());
  const rows = views.rows('view', version, 0, 10) ?? [];
  expect(Object.fromEntries(rows.map((row) => [row.id, row.rating]))).toEqual({
    'beach.jpg': 5,
    'clip.mov': 3,
    'dunes.jpg': 2,
    'sea.jpg': undefined,
    trips: 4,
    work: undefined,
  });
});

test('a rating filter lets through what has at least as many stars, folders included', () => {
  const catalog = ratedLibrary();
  expect(openView(catalog, filtered({ rating: ['3'] }))).toEqual([
    'trips',
    'beach.jpg',
    'clip.mov',
  ]);
  expect(openView(catalog, filtered({ rating: ['5'] }))).toEqual(['beach.jpg']);
  // Values of one field let an entry through if any does, so the fewest stars count.
  expect(openView(catalog, filtered({ rating: ['5', '2'] }))).toEqual([
    'trips',
    'beach.jpg',
    'clip.mov',
    'dunes.jpg',
  ]);
  // Other filters still leave folders out.
  expect(openView(catalog, filtered({ format: ['Photo'], rating: ['3'] }))).toEqual(['beach.jpg']);
});

test('facets count entries with each number of stars or more', () => {
  const catalog = ratedLibrary();
  const views = catalog.views();
  views.open('view', spec());
  expect(views.facets('view')?.fields.rating).toEqual([
    { count: 1, value: '5' },
    { count: 2, value: '4' },
    { count: 3, value: '3' },
    { count: 4, value: '2' },
    { count: 4, value: '1' },
  ]);
});

test('a photo rewritten loses the rating its file had until read again', () => {
  const catalog = ratedLibrary();
  catalog.write([{ listed: [entry('beach.jpg', { metadata: changedAt(2000, 60) })] }]);
  expect(openView(catalog, filtered({ rating: ['5'] }))).toEqual([]);
});

test('a kept rating goes when it is taken away', () => {
  const catalog = ratedLibrary();
  rateStored(catalog.stored, 'trips', null);
  catalog.touch();
  expect(openView(catalog, filtered({ rating: ['4'] }))).toEqual(['beach.jpg']);
});

test('kept ratings follow a rename, with everything inside a folder', () => {
  const catalog = ratedLibrary();
  catalog.write([{ listed: [entry('trips/old.mov', { kind: 'video' })] }]);
  rateStored(catalog.stored, 'trips/old.mov', 1);
  moveStored(catalog.stored, 'trips', 'travel');
  catalog.write([
    { removed: ['trips'] },
    { listed: [entry('travel'), entry('travel/old.mov', { kind: 'video' })] },
  ]);
  expect(openView(catalog, { ...filtered({ rating: ['1'] }), recursive: true })).toEqual([
    'travel',
    'beach.jpg',
    'clip.mov',
    'dunes.jpg',
    'travel/old.mov',
  ]);
});
