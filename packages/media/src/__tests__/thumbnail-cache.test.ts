import {
  flatThumbnailFile,
  hasThumbnail,
  markUsed,
  pruneThumbnails,
  type ThumbnailCache,
  thumbnailCache,
  thumbnailFile,
} from '#thumbnail-cache';
import { indexedBytes, isRebuilt, leastRecentlyUsed, recordThumbnail } from '#thumbnail-index';
import { upkeepThumbnailCache } from '#thumbnail-upkeep';
import { mkdir, mkdtemp, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, onTestFinished, test } from 'vitest';

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'thumbnail-cache-'));
  onTestFinished(() => rm(root, { force: true, recursive: true }));
  return path.join(root, 'thumbnails');
}

/** A key that starts with `prefix`. */
function keyOf(prefix: string) {
  return prefix.padEnd(64, '0');
}

/** Writes a thumbnail of `bytes` bytes to `file`, last changed at `modifiedMs`. */
async function put(file: string, bytes: number, modifiedMs = Date.now()) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, 'x'.repeat(bytes));
  const time = new Date(modifiedMs);
  await utimes(file, time, time);
}

async function exists(file: string) {
  return Boolean(await stat(file).catch(() => null));
}

/** Every key the index has, used longest ago first. */
function indexed(cache: ThumbnailCache) {
  return leastRecentlyUsed(cache.index, 1000).map((thumbnail) => thumbnail.key);
}

test('pruning removes the thumbnails used longest ago, as the index says, down to the budget', async () => {
  const cache = thumbnailCache(await fixture(), 25);
  await upkeepThumbnailCache(cache);
  const oldest = keyOf('a1');
  const old = keyOf('b2');
  const used = keyOf('c3');
  const newest = keyOf('d4');
  for (const [at, key] of [oldest, old, used, newest].entries()) {
    await put(thumbnailFile(cache.directory, key), 10);
    recordThumbnail(cache.index, { key, size: 10, usedMs: 1000 + at });
  }
  // Shown since, so it counts as used now.
  await hasThumbnail(cache, used);
  // Removed behind the index's back, which only means it is pruned first.
  const gone = keyOf('0f');
  recordThumbnail(cache.index, { key: gone, size: 10, usedMs: 0 });
  // In a subfolder but not in the index: pruning never reads the subfolders, so it stays.
  const unindexed = keyOf('e5');
  await put(thumbnailFile(cache.directory, unindexed), 10);

  await pruneThumbnails(cache);

  expect(indexed(cache)).toEqual([newest, used]);
  expect(indexedBytes(cache.index)).toBe(20);
  for (const [key, kept] of [
    [oldest, false],
    [old, false],
    [newest, true],
    [used, true],
    [unindexed, true],
  ] as const) {
    expect(await exists(thumbnailFile(cache.directory, key))).toBe(kept);
  }
});

test('a thumbnail kept as earlier versions kept it is found, and moved into its subfolder', async () => {
  const cache = thumbnailCache(await fixture());
  const shown = keyOf('ab');
  const waiting = keyOf('cd');
  await put(flatThumbnailFile(cache.directory, shown), 10);
  await put(flatThumbnailFile(cache.directory, waiting), 20, 5000);

  await expect(hasThumbnail(cache, shown)).resolves.toBe(true);
  expect(await exists(thumbnailFile(cache.directory, shown))).toBe(true);
  expect(await exists(flatThumbnailFile(cache.directory, shown))).toBe(false);

  await upkeepThumbnailCache(cache);
  expect(await exists(thumbnailFile(cache.directory, waiting))).toBe(true);
  expect(await exists(flatThumbnailFile(cache.directory, waiting))).toBe(false);
  expect(cache.flat).toBe(false);
  // Its file time stands for when it was last used.
  expect(leastRecentlyUsed(cache.index, 1)).toEqual([{ key: waiting, size: 20, usedMs: 5000 }]);
});

test('an index that was lost or cannot be read is made again from the folder', async () => {
  const directory = await fixture();
  const key = keyOf('12');
  await put(thumbnailFile(directory, key), 10, 7000);
  await mkdir(path.dirname(directory), { recursive: true });
  await writeFile(`${directory}.db`, 'not a database');

  const cache = thumbnailCache(directory, 0);
  expect(isRebuilt(cache.index)).toBe(false);
  // Until it is made again, the index may lack thumbnails, so pruning leaves them be.
  await pruneThumbnails(cache);
  expect(await exists(thumbnailFile(directory, key))).toBe(true);

  await upkeepThumbnailCache(cache);
  expect(leastRecentlyUsed(cache.index, 10)).toEqual([{ key, size: 10, usedMs: 7000 }]);
  await pruneThumbnails(cache);
  expect(await exists(thumbnailFile(directory, key))).toBe(false);
  expect(indexed(cache)).toEqual([]);
});

test('a thumbnail shown without a look at its file is marked used only if the index has it', async () => {
  const cache = thumbnailCache(await fixture(), 10);
  await upkeepThumbnailCache(cache);
  const first = keyOf('01');
  const second = keyOf('02');
  for (const [at, key] of [first, second].entries()) {
    await put(thumbnailFile(cache.directory, key), 10);
    recordThumbnail(cache.index, { key, size: 10, usedMs: at });
  }
  markUsed(cache, first);
  markUsed(cache, keyOf('ff'));
  await pruneThumbnails(cache);
  expect(indexed(cache)).toEqual([first]);
});
