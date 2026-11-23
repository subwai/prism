import { changedAt, details, entry, openCatalog, spec } from '#__tests__/fixtures';
import { entryNumberOf } from '#repositories/entries/entries';
import {
  detailsQueue,
  nextUnread,
  skip,
  stopSkipping,
  updateQueuedViews,
} from '#services/details/details-queue';
import { expect, test } from 'vitest';

test('details are read for what the window shows, then the view, then the library', () => {
  const catalog = openCatalog();
  catalog.write([
    {
      entries: [
        ...Array.from({ length: 6 }, (_photo, index) => entry(`a/${index}.jpg`)),
        entry('b/library.jpg'),
      ],
      kind: 'list',
    },
  ]);
  const views = catalog.views();
  const queue = detailsQueue();
  const { version } = views.openNow('view', spec({ directoryId: 'a' }));
  views.rows('view', version, 4, 2);
  const queued = updateQueuedViews([], views.byUse());
  const ids = (limit: number) =>
    nextUnread(catalog.db, catalog.library, { limit, queue, views: queued }).map(({ id }) => id);
  expect(ids(2)).toEqual(['a/4.jpg', 'a/5.jpg']);
  expect(ids(4).slice(2)).toEqual(['a/0.jpg', 'a/1.jpg']);
  expect(ids(10)).toHaveLength(7);
  expect(ids(10).at(-1)).toBe('b/library.jpg');

  // Photos that could not be read wait for a read that lists them afresh.
  const unreadable = entryNumberOf(catalog.db, catalog.library, 'a/4.jpg') ?? 0;
  skip(queue, [unreadable]);
  expect(ids(10)).not.toContain('a/4.jpg');
  stopSkipping(queue, [unreadable]);
  expect(ids(1)).toEqual(['a/4.jpg']);
});

test('the library is looked through once, then again from the start', () => {
  const catalog = openCatalog();
  catalog.write([{ entries: ['a.jpg', 'b.jpg', 'c.jpg'].map((id) => entry(id)), kind: 'list' }]);
  const queue = detailsQueue();
  const next = () =>
    nextUnread(catalog.db, catalog.library, { limit: 2, queue, views: [] }).map(({ id }) => id);
  expect(next()).toEqual(['a.jpg', 'b.jpg']);
  catalog.write([{ details: [details('a.jpg', {}), details('b.jpg', {})], kind: 'storeDetails' }]);
  expect(next()).toEqual(['c.jpg']);
  catalog.write([{ details: [details('c.jpg', {})], kind: 'storeDetails' }]);
  expect(next()).toEqual([]);

  // A file that changed is read again, though the library was looked through past it.
  catalog.write([{ entries: [entry('a.jpg', { metadata: changedAt(9, 1) })], kind: 'list' }]);
  expect(next()).toEqual(['a.jpg']);
});
