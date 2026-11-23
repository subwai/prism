import { entry, openDatabase } from '#__tests__/fixtures';
import { catalogDatabase } from '#database/catalog-database';
import { openRatingsToWrite } from '#database/ratings/open';
import { hasStoredListing } from '#repositories/tree-listings';
import { TREE_LISTING_FORMAT } from '#services/tree/tree-listing';
import { CatalogWriter } from '#threads/writer';
import { expect, onTestFinished, test, vi } from 'vitest';

function openWriter() {
  vi.useFakeTimers();
  onTestFinished(() => {
    vi.useRealTimers();
  });
  const connections = { index: openDatabase(), ratings: openRatingsToWrite(':memory:') };
  onTestFinished(() => connections.ratings.close());
  const writer = new CatalogWriter(connections, '/library', () => null);
  onTestFinished(() => writer.close());
  const db = catalogDatabase(connections.index);
  return { kept: () => hasStoredListing(db, writer.library(), TREE_LISTING_FORMAT), writer };
}

test('the writer makes the tree listing once writes that change it stop for five seconds', () => {
  const { kept, writer } = openWriter();
  // A library with none, as one opened for the first time, has one made as it opens too.
  vi.advanceTimersByTime(5000);
  expect(kept()).toBe(true);

  writer.write([{ entries: [entry('Trips')], kind: 'list' }]);
  expect(kept()).toBe(false);
  vi.advanceTimersByTime(3000);
  // Another such write puts it off again, as a library being read changes it all the time.
  writer.write([{ entries: [entry('Trips/a.jpg')], kind: 'list' }]);
  vi.advanceTimersByTime(4999);
  expect(kept()).toBe(false);
  vi.advanceTimersByTime(1);
  expect(kept()).toBe(true);
});

test('a writer closed makes no tree listing', () => {
  const { kept, writer } = openWriter();
  writer.write([{ entries: [entry('Trips')], kind: 'list' }]);
  writer.close();
  vi.advanceTimersByTime(5000);
  expect(kept()).toBe(false);
});

test('forgetting every photo’s details reads again the photos skipped this session', () => {
  const { writer } = openWriter();
  writer.write([{ entries: [entry('a.jpg')], kind: 'list' }]);
  const [photo] = writer.photosToRead(10);
  // As the enricher skips a photo that failed while the share was offline.
  writer.skip([photo?.item ?? -1]);
  expect(writer.photosToRead(10)).toEqual([]);

  writer.write([{ kind: 'forgetDetails' }]);

  expect(writer.photosToRead(10).map(({ id }) => id)).toEqual(['a.jpg']);
});
