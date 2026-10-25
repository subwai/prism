import { ThumbnailCache, thumbnailKey } from '#photos/thumbnails';
import { WorkQueue } from '#photos/work-queue';
import { mkdtemp, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { expect, onTestFinished, test, vi } from 'vitest';

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'photo-thumbnails-'));
  onTestFinished(() => rm(root, { force: true, recursive: true }));
  return root;
}

async function image(file: string, width = 800, height = 600) {
  await sharp({ create: { background: '#4678ab', channels: 3, height, width } })
    .png()
    .toFile(file);
}

async function source(file: string) {
  return { file, info: await stat(file) };
}

test('thumbnail cache bounds dimensions, preserves small images, and versions changed sources', async () => {
  const root = await fixture();
  const file = path.join(root, 'photo.png');
  const directory = path.join(root, 'cache');
  const cache = new ThumbnailCache(directory);
  const { signal } = new AbortController();
  await image(file);
  const key = thumbnailKey(await source(file), false);
  await expect(cache.has(key)).resolves.toBe(false);
  await cache.generate(await source(file), key, signal);
  await expect(cache.has(key)).resolves.toBe(true);
  const same = await source(file);
  expect(thumbnailKey(same, false)).toBe(key);
  expect(thumbnailKey(same, true)).not.toBe(key);
  expect(await sharp(path.join(directory, `${key}.webp`)).metadata()).toMatchObject({
    height: 288,
    width: 384
  });
  await image(file, 80, 60);
  const changed = thumbnailKey(await source(file), false);
  expect(changed).not.toBe(key);
  await cache.generate(await source(file), changed, signal);
  expect(await sharp(path.join(directory, `${changed}.webp`)).metadata()).toMatchObject({
    height: 60,
    width: 80
  });
  expect((await readdir(directory)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
});

test('a renamed photo keeps its cached thumbnail', async () => {
  const root = await fixture();
  const before = path.join(root, 'before.png'),
    after = path.join(root, 'after.png');
  await image(before);
  const key = thumbnailKey(await source(before), false);
  await rename(before, after);
  const renamed = await source(after);
  expect(thumbnailKey(renamed, false)).toBe(key);
});

test('queue shares work among callers and bounds how much runs at once', async () => {
  const queue = new WorkQueue<number>(1, 4, new AbortController().signal);
  const gate = Promise.withResolvers<number>();
  const work = vi.fn(() => gate.promise);
  const first = queue.run('shared', work);
  expect(queue.run('shared', work)).toBe(first);
  const next = vi.fn(() => Promise.resolve(2));
  const queued = queue.run('next', next);
  await Promise.resolve();
  expect(next).not.toHaveBeenCalled();
  gate.resolve(42);
  await expect(first).resolves.toBe(42);
  await expect(queued).resolves.toBe(2);
  expect(work).toHaveBeenCalledOnce();
});

test('cache eviction enforces its disk budget', async () => {
  const root = await fixture();
  const file = path.join(root, `${'a'.repeat(64)}.webp`);
  await writeFile(file, 'cache');
  await new ThumbnailCache(root, 0).prune();
  await expect(stat(file)).rejects.toMatchObject({ code: 'ENOENT' });
});
