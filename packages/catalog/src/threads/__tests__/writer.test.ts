import { entry, openDatabase } from '#__tests__/fixtures';
import { catalogDatabase } from '#data/database';
import { hasStoredListing } from '#data/stored-tree-listings';
import { connectRatings } from '#files/ratings-file';
import { CatalogWriter } from '#threads/writer';
import { TREE_LISTING_FORMAT } from '#tree/tree-listing';
import { expect, onTestFinished, test, vi } from 'vitest';

function openWriter() {
  vi.useFakeTimers();
  onTestFinished(() => {
    vi.useRealTimers();
  });
  const connections = { index: openDatabase(), ratings: connectRatings(':memory:') };
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

  writer.write([{ listed: [entry('Trips')] }]);
  expect(kept()).toBe(false);
  vi.advanceTimersByTime(3000);
  // Another such write puts it off again, as a library being read changes it all the time.
  writer.write([{ listed: [entry('Trips/a.jpg')] }]);
  vi.advanceTimersByTime(4999);
  expect(kept()).toBe(false);
  vi.advanceTimersByTime(1);
  expect(kept()).toBe(true);
});

test('a writer closed makes no tree listing', () => {
  const { kept, writer } = openWriter();
  writer.write([{ listed: [entry('Trips')] }]);
  writer.close();
  vi.advanceTimersByTime(5000);
  expect(kept()).toBe(false);
});
