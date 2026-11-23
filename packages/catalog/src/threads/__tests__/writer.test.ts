import { details, entry, openDatabase } from '#__tests__/fixtures';
import { type CatalogDatabase, catalogDatabase } from '#database/catalog-database';
import { openIndexToWrite } from '#database/photo-index/open';
import { openRatingsToWrite } from '#database/ratings/open';
import { hasStoredListing } from '#repositories/tree-listings';
import { FORGET_BATCH_SIZE } from '#services/details/forget-details';
import { TREE_LISTING_FORMAT } from '#services/tree/tree-listing';
import { CatalogWriter } from '#threads/writer';
import type { WriterEvent } from '#threads/writer-api';
import { sql } from 'drizzle-orm';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
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

  writer.forgetDetails();
  vi.runAllTimers();

  expect(writer.photosToRead(10).map(({ id }) => id)).toEqual(['a.jpg']);
});

/** A writer on a catalog file, to open again as the app does at its next launch. */
async function openWriterOnFile() {
  vi.useFakeTimers();
  onTestFinished(() => {
    vi.useRealTimers();
  });
  const directory = await mkdtemp(path.join(tmpdir(), 'writer-'));
  onTestFinished(() => rm(directory, { force: true, recursive: true }));
  const file = path.join(directory, 'photo-index.db');
  const ratings = openRatingsToWrite(':memory:');
  onTestFinished(() => ratings.close());
  const open = () => {
    const index = openIndexToWrite(file);
    const events: WriterEvent[] = [];
    const writer = new CatalogWriter({ index, ratings }, '/library', (event) => events.push(event));
    const close = () => {
      writer.close();
      if (index.isOpen) {
        index.close();
      }
    };
    onTestFinished(close);
    return { close, db: catalogDatabase(index), events, writer };
  };
  return open;
}

/**
 * Two photos a batch apart: `a.jpg` is entry 1, and `b.jpg` comes after a gap as wide as a batch,
 * as in a large catalog. Both have their details read.
 */
function listTwoBatchesApart(writer: CatalogWriter, db: CatalogDatabase) {
  writer.write([{ entries: [entry('a.jpg')], kind: 'list' }]);
  db.run(sql`UPDATE sqlite_sequence SET seq = ${FORGET_BATCH_SIZE + 10} WHERE name = 'items'`);
  writer.write([
    { entries: [entry('b.jpg')], kind: 'list' },
    { details: [details('a.jpg', {}), details('b.jpg', {})], kind: 'storeDetails' },
  ]);
}

/** The photos the writer would have read next, by ID. */
function toRead(writer: CatalogWriter) {
  return writer.photosToRead(10).map(({ id }) => id);
}

test('a forget goes a batch at a time, reporting how far it has got, and then that it is done', async () => {
  const open = await openWriterOnFile();
  const { db, events, writer } = open();
  listTwoBatchesApart(writer, db);

  writer.forgetDetails();
  vi.advanceTimersToNextTimer();
  expect(toRead(writer)).toEqual(['a.jpg']);
  expect(events.at(-1)).toEqual({
    kind: 'forgetting',
    progress: { done: FORGET_BATCH_SIZE, total: FORGET_BATCH_SIZE + 11 },
  });

  vi.advanceTimersToNextTimer();
  expect(toRead(writer).toSorted()).toEqual(['a.jpg', 'b.jpg']);
  expect(events.at(-1)).toEqual({ kind: 'detailsForgotten' });
});

test('a forget the app quit during carries on at the next launch, and a new one starts over', async () => {
  const open = await openWriterOnFile();
  const first = open();
  listTwoBatchesApart(first.writer, first.db);
  first.writer.forgetDetails();
  vi.advanceTimersToNextTimer();
  first.close();

  const next = open();
  expect(toRead(next.writer)).toEqual(['a.jpg']);
  vi.runAllTimers();
  expect(toRead(next.writer).toSorted()).toEqual(['a.jpg', 'b.jpg']);
  expect(next.events).toContainEqual({ kind: 'detailsForgotten' });

  // Read again, then forgotten twice: the second starts over, rather than running beside it.
  next.writer.write([
    { details: [details('a.jpg', {}), details('b.jpg', {})], kind: 'storeDetails' },
  ]);
  next.writer.forgetDetails();
  vi.advanceTimersToNextTimer();
  next.writer.forgetDetails();
  expect(toRead(next.writer)).toEqual(['a.jpg']);
  vi.runAllTimers();
  expect(toRead(next.writer).toSorted()).toEqual(['a.jpg', 'b.jpg']);
  expect(next.events.filter((event) => event.kind === 'detailsForgotten')).toHaveLength(2);
});
