import { changedAt, details, entry, openDatabase } from '#__tests__/fixtures';
import { openIndexToWrite } from '#database/photo-index/open';
import { openRatingsToWrite } from '#database/ratings/open';
import { forgetDetails } from '#services/details/forget-details';
import { CatalogWriter, type WriterEvent } from '#threads/writer';
import type { DetailsProgress } from '@prism/shared';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, onTestFinished, test } from 'vitest';

function openWriter(database = openDatabase()) {
  const ratings = openRatingsToWrite(':memory:');
  onTestFinished(() => ratings.close());
  const told: DetailsProgress[] = [];
  const unread: (number | undefined)[] = [];
  const writer = new CatalogWriter(
    { index: database, ratings },
    '/library',
    (event: WriterEvent) => {
      if (event.kind === 'details') {
        told.push(event.details);
      } else if (event.kind === 'changed') {
        unread.push(event.unread);
      }
    },
  );
  onTestFinished(() => writer.close());
  // As the catalog has it count once its reader starts.
  writer.countDetails();
  return { told, unread, writer };
}

test('the writer counts the photos whose details are read as writes add, read, change and remove them', () => {
  const { told, writer } = openWriter();
  expect(told).toEqual([{ photos: 0, read: 0, unreadable: 0 }]);
  writer.write([
    {
      entries: [
        entry('Trips'),
        entry('Trips/a.jpg'),
        entry('Trips/b.jpg'),
        entry('Trips/c.jpg'),
        entry('Trips/clip.mov', { kind: 'video' }),
      ],
      kind: 'list',
    },
  ]);
  expect(told.at(-1)).toEqual({ photos: 3, read: 0, unreadable: 0 });
  writer.write([
    { details: [details('Trips/a.jpg', {}), details('Trips/b.jpg', {})], kind: 'storeDetails' },
  ]);
  expect(told.at(-1)).toEqual({ photos: 3, read: 2, unreadable: 0 });
  // A file that changed loses its details.
  writer.write([{ entries: [entry('Trips/a.jpg', { metadata: changedAt(2000) })], kind: 'list' }]);
  expect(told.at(-1)).toEqual({ photos: 3, read: 1, unreadable: 0 });
  writer.write([{ ids: ['Trips'], kind: 'remove' }]);
  expect(told.at(-1)).toEqual({ photos: 0, read: 0, unreadable: 0 });
});

test('the writer tells no count until asked to count, which counts the writes before it', () => {
  const ratings = openRatingsToWrite(':memory:');
  onTestFinished(() => ratings.close());
  const told: (DetailsProgress | number | undefined)[] = [];
  const writer = new CatalogWriter({ index: openDatabase(), ratings }, '/library', (event) => {
    if (event.kind === 'details') {
      told.push(event.details);
    } else if (event.kind === 'changed') {
      told.push(event.unread);
    }
  });
  onTestFinished(() => writer.close());
  writer.write([
    { entries: [entry('a.jpg'), entry('b.jpg')], kind: 'list' },
    { details: [details('a.jpg', {})], kind: 'storeDetails' },
  ]);
  // The reader counts the whole library's unread photos itself until then.
  expect(told).toEqual([undefined]);
  writer.countDetails();
  writer.rate('a.jpg', 3);
  expect(told).toEqual([undefined, { photos: 2, read: 1, unreadable: 0 }, 1]);
});

test('a write that changes no count tells nothing', () => {
  const { told, writer } = openWriter();
  writer.write([{ entries: [entry('a.jpg')], kind: 'list' }]);
  const before = told.length;
  writer.write([
    { entries: [entry('a.jpg')], kind: 'list' },
    { entries: [entry('Trips')], kind: 'list' },
  ]);
  expect(told).toHaveLength(before);
});

test('the writer counts again when asked, as after another thread forgot every photo’s details', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'details-count-'));
  onTestFinished(() => rm(directory, { force: true, recursive: true }));
  const file = path.join(directory, 'photo-index.db');
  const database = openIndexToWrite(file);
  onTestFinished(() => database.close());
  const { told, writer } = openWriter(database);
  writer.write([
    { entries: [entry('a.jpg')], kind: 'list' },
    { details: [details('a.jpg', {})], kind: 'storeDetails' },
  ]);
  expect(told.at(-1)).toEqual({ photos: 1, read: 1, unreadable: 0 });
  // Its own connection's writes fire none of the writer's triggers.
  forgetDetails(file);
  writer.countDetails();
  expect(told.at(-1)).toEqual({ photos: 1, read: 0, unreadable: 0 });
});

/** The photo at `id` as its details could not be read, as it was listed. */
function unreadable(id: string, modifiedMs = 1000) {
  return { id, modifiedMs, size: 50 };
}

test('photos whose details could not be read count as read, and apart', () => {
  const { told, writer } = openWriter();
  writer.write([{ entries: [entry('a.jpg'), entry('b.jpg')], kind: 'list' }]);
  writer.write([{ files: [unreadable('a.jpg')], kind: 'markUnreadable' }]);
  expect(told.at(-1)).toEqual({ photos: 2, read: 1, unreadable: 1 });
  // A file that changed since is tried again.
  writer.write([{ entries: [entry('a.jpg', { metadata: changedAt(2000) })], kind: 'list' }]);
  expect(told.at(-1)).toEqual({ photos: 2, read: 0, unreadable: 0 });
  writer.write([
    { files: [unreadable('a.jpg', 2000)], kind: 'markUnreadable' },
    { ids: ['a.jpg'], kind: 'remove' },
  ]);
  expect(told.at(-1)).toEqual({ photos: 1, read: 0, unreadable: 0 });
});

test('photos whose details could not be read are counted as the library opens, and forgotten with every photo’s details', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'details-count-'));
  onTestFinished(() => rm(directory, { force: true, recursive: true }));
  const file = path.join(directory, 'photo-index.db');
  const database = openIndexToWrite(file);
  onTestFinished(() => database.close());
  openWriter(database).writer.write([
    { entries: [entry('a.jpg'), entry('b.jpg')], kind: 'list' },
    { files: [unreadable('a.jpg')], kind: 'markUnreadable' },
  ]);
  const { told, writer } = openWriter(database);
  expect(told).toEqual([{ photos: 2, read: 1, unreadable: 1 }]);
  forgetDetails(file);
  writer.countDetails();
  expect(told.at(-1)).toEqual({ photos: 2, read: 0, unreadable: 0 });
});

test('each write the writer tells of says how many photos still lack details, for views of the whole library', () => {
  const { unread, writer } = openWriter();
  writer.write([
    {
      entries: [entry('a.jpg'), entry('b.jpg'), entry('clip.mov', { kind: 'video' })],
      kind: 'list',
    },
  ]);
  writer.write([{ details: [details('a.jpg', {})], kind: 'storeDetails' }]);
  writer.write([{ files: [unreadable('b.jpg')], kind: 'markUnreadable' }]);
  writer.rate('clip.mov', 3);
  expect(unread).toEqual([2, 1, 0, 0]);
});
