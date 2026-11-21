import { changedAt, details, entry, openDatabase } from '#__tests__/fixtures';
import { connectIndex, forgetDetails } from '#photo-index';
import { connectRatings } from '#ratings-file';
import { CatalogWriter, type WriterEvent } from '#writer';
import type { DetailsProgress } from '@prism/shared';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, onTestFinished, test } from 'vitest';

function openWriter(database = openDatabase()) {
  const ratings = connectRatings(':memory:');
  onTestFinished(() => ratings.close());
  const told: DetailsProgress[] = [];
  const writer = new CatalogWriter(
    { index: database, ratings },
    '/library',
    (event: WriterEvent) => {
      if ('details' in event) {
        told.push(event.details);
      }
    },
  );
  onTestFinished(() => writer.close());
  return { told, writer };
}

test('the writer counts the photos whose details are read as writes add, read, change and remove them', () => {
  const { told, writer } = openWriter();
  expect(told).toEqual([{ photos: 0, read: 0, unreadable: 0 }]);
  writer.write([
    {
      listed: [
        entry('Trips'),
        entry('Trips/a.jpg'),
        entry('Trips/b.jpg'),
        entry('Trips/c.jpg'),
        entry('Trips/clip.mov', { kind: 'video' }),
      ],
    },
  ]);
  expect(told.at(-1)).toEqual({ photos: 3, read: 0, unreadable: 0 });
  writer.write([{ details: [details('Trips/a.jpg', {}), details('Trips/b.jpg', {})] }]);
  expect(told.at(-1)).toEqual({ photos: 3, read: 2, unreadable: 0 });
  // A file that changed loses its details.
  writer.write([{ listed: [entry('Trips/a.jpg', { metadata: changedAt(2000) })] }]);
  expect(told.at(-1)).toEqual({ photos: 3, read: 1, unreadable: 0 });
  writer.write([{ removed: ['Trips'] }]);
  expect(told.at(-1)).toEqual({ photos: 0, read: 0, unreadable: 0 });
});

test('a write that changes no count tells nothing', () => {
  const { told, writer } = openWriter();
  writer.write([{ listed: [entry('a.jpg')] }]);
  const before = told.length;
  writer.write([{ listed: [entry('a.jpg')] }, { listed: [entry('Trips')] }]);
  expect(told).toHaveLength(before);
});

test('the writer counts again when asked, as after another thread forgot every photo’s details', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'details-count-'));
  onTestFinished(() => rm(directory, { force: true, recursive: true }));
  const file = path.join(directory, 'photo-index.db');
  const database = connectIndex(file);
  onTestFinished(() => database.close());
  const { told, writer } = openWriter(database);
  writer.write([{ listed: [entry('a.jpg')] }, { details: [details('a.jpg', {})] }]);
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
  writer.write([{ listed: [entry('a.jpg'), entry('b.jpg')] }]);
  writer.write([{ unreadable: [unreadable('a.jpg')] }]);
  expect(told.at(-1)).toEqual({ photos: 2, read: 1, unreadable: 1 });
  // A file that changed since is tried again.
  writer.write([{ listed: [entry('a.jpg', { metadata: changedAt(2000) })] }]);
  expect(told.at(-1)).toEqual({ photos: 2, read: 0, unreadable: 0 });
  writer.write([{ unreadable: [unreadable('a.jpg', 2000)] }, { removed: ['a.jpg'] }]);
  expect(told.at(-1)).toEqual({ photos: 1, read: 0, unreadable: 0 });
});

test('photos whose details could not be read are counted as the library opens, and forgotten with every photo’s details', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'details-count-'));
  onTestFinished(() => rm(directory, { force: true, recursive: true }));
  const file = path.join(directory, 'photo-index.db');
  const database = connectIndex(file);
  onTestFinished(() => database.close());
  openWriter(database).writer.write([
    { listed: [entry('a.jpg'), entry('b.jpg')] },
    { unreadable: [unreadable('a.jpg')] },
  ]);
  const { told, writer } = openWriter(database);
  expect(told).toEqual([{ photos: 2, read: 1, unreadable: 1 }]);
  forgetDetails(file);
  writer.countDetails();
  expect(told.at(-1)).toEqual({ photos: 2, read: 0, unreadable: 0 });
});
