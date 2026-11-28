import { openThumbnailIndex, type ThumbnailIndex } from '#thumbnails/thumbnail-index/file';
import {
  forgetAllThumbnails,
  forgetThumbnails,
  indexedBytes,
  leastRecentlyUsed,
  recordFound,
  recordThumbnail,
  touchThumbnail,
} from '#thumbnails/thumbnail-index/queries';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, onTestFinished, test, vi } from 'vitest';

/** The bytes of every thumbnail the index has, summed afresh. */
function summedBytes(db: ThumbnailIndex) {
  const row = db.$client.prepare('SELECT coalesce(sum(size), 0) AS bytes FROM thumbnails').get();
  return Number(row?.bytes);
}

/** A thumbnail index in a file of its own, which several connections can open. */
async function indexFile() {
  const folder = await mkdtemp(path.join(tmpdir(), 'thumbnail-index-'));
  onTestFinished(() => rm(folder, { force: true, recursive: true }));
  return path.join(folder, 'thumbnails.db');
}

test('pruning reads the thumbnails used longest ago through thumbnails_used', () => {
  const db = openThumbnailIndex(':memory:');
  for (const [key, usedMs] of [
    ['b', 2000],
    ['a', 1000],
    ['c', 3000],
  ] as const) {
    recordThumbnail(db, { key, size: 10, usedMs });
  }
  const plans: string[] = [];
  const database = db.$client;
  const prepare = database.prepare.bind(database);
  vi.spyOn(database, 'prepare').mockImplementation((text) => {
    plans.push(
      prepare(`EXPLAIN QUERY PLAN ${text}`)
        .all()
        .map((row) => String(row.detail))
        .join('\n'),
    );
    return prepare(text);
  });

  expect(leastRecentlyUsed(db, 2).map((thumbnail) => thumbnail.key)).toEqual(['a', 'b']);
  // Without the index, pruning sorts every thumbnail in the cache, about 380,000 of them.
  expect(plans.join('\n')).toMatch(/SCAN thumbnails USING INDEX thumbnails_used/u);
});

test('the total of bytes follows every write, as a full sum finds it', () => {
  const db = openThumbnailIndex(':memory:');
  expect(indexedBytes(db)).toBe(0);
  recordThumbnail(db, { key: 'a', size: 100, usedMs: 1 });
  recordThumbnail(db, { key: 'b', size: 30, usedMs: 1 });
  // Made again at another size, then found in the folder, which changes nothing.
  recordThumbnail(db, { key: 'a', size: 70, usedMs: 2 });
  recordFound(db, { key: 'a', size: 999, usedMs: 3 });
  recordFound(db, { key: 'c', size: 5, usedMs: 3 });
  touchThumbnail(db, 'b', 4);
  expect(indexedBytes(db)).toBe(105);
  expect(indexedBytes(db)).toBe(summedBytes(db));

  forgetThumbnails(db, ['a', 'missing']);
  expect(indexedBytes(db)).toBe(35);
  forgetAllThumbnails(db);
  expect(indexedBytes(db)).toBe(0);
});

test('the total stays right with several processes writing to one index', async () => {
  const file = await indexFile();
  const [first, second] = [openThumbnailIndex(file), openThumbnailIndex(file)];
  onTestFinished(() => {
    first?.$client.close();
    second?.$client.close();
  });
  for (let index = 0; index < 50; index += 1) {
    recordThumbnail(first, { key: `first-${index}`, size: index, usedMs: index });
    recordThumbnail(second, { key: `second-${index}`, size: 2 * index, usedMs: index });
    // Each changes a row the other wrote.
    recordThumbnail(second, { key: `first-${index}`, size: index + 1, usedMs: index });
  }
  forgetThumbnails(first, ['second-0', 'second-1']);

  expect(indexedBytes(first)).toBe(summedBytes(first));
  expect(indexedBytes(second)).toBe(summedBytes(second));
  expect(indexedBytes(first)).toBe((50 * 51) / 2 + 2 * ((49 * 50) / 2) - 2);
});

test('an index made before the total was kept starts it at the sum of what it has', async () => {
  const file = await indexFile();
  const before = openThumbnailIndex(file);
  recordThumbnail(before, { key: 'a', size: 40, usedMs: 1 });
  // As the index was before the migration that keeps the total: thumbnails, but no total.
  before.$client.exec(`
    DROP TRIGGER thumbnails_added;
    DROP TRIGGER thumbnails_resized;
    DROP TRIGGER thumbnails_removed;
    DELETE FROM thumbnail_totals;
    DELETE FROM __drizzle_migrations WHERE name LIKE '%thumbnail_totals_triggers';
  `);
  recordThumbnail(before, { key: 'b', size: 2, usedMs: 1 });
  before.$client.close();

  const after = openThumbnailIndex(file);
  onTestFinished(() => after.$client.close());
  expect(indexedBytes(after)).toBe(42);
  recordThumbnail(after, { key: 'c', size: 8, usedMs: 1 });
  expect(indexedBytes(after)).toBe(summedBytes(after));
});
