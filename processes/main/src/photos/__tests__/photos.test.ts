import { createPhotoBackend } from '#photos/backend';
import { PhotoLibrary } from '#photos/library';
import { ThumbnailCache } from '#photos/thumbnails';
import { WorkQueue } from '#photos/work-queue';
import { mkdir, mkdtemp, readdir, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { expect, onTestFinished, test, vi } from 'vitest';

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'photo-api-'));
  onTestFinished(() => rm(root, { force: true, recursive: true }));
  return root;
}

async function openLibrary(root: string) {
  const library = await PhotoLibrary.open(root);
  onTestFinished(() => library.close());
  return library;
}

async function collect(library: PhotoLibrary, scanId: string) {
  const entries = [];
  let batch;
  do {
    batch = await library.nextBatch(scanId);
    expect(batch.errors).toEqual([]);
    entries.push(...batch.entries);
  } while (!batch.done);
  return entries;
}

async function image(file: string, width = 800, height = 600) {
  await sharp({ create: { background: '#4678ab', channels: 3, height, width } })
    .png()
    .toFile(file);
}

test('scans pull bounded batches, skip symlinks, and defer metadata', async () => {
  const root = await fixture();
  await Promise.all(
    Array.from({ length: 300 }, (_entry, index) => writeFile(path.join(root, `${index}.jpg`), ''))
  );
  await symlink(root, path.join(root, 'loop'), 'dir');
  const library = await openLibrary(root);
  const scanId = library.startScan({ directoryId: '.' });
  const first = await library.nextBatch(scanId);
  expect(first.entries).toHaveLength(128);
  expect(first.done).toBe(false);
  const entries = [...first.entries, ...(await collect(library, scanId))];
  expect(entries).toHaveLength(300);
  expect(new Set(entries.map((entry) => entry.id)).size).toBe(300);
  expect(entries.every((entry) => entry.kind === 'image' && !entry.metadata)).toBe(true);
});

test('recursive scans exclude hidden branches and optionally include timestamps', async () => {
  const root = await fixture();
  await mkdir(path.join(root, 'included'));
  await mkdir(path.join(root, 'excluded'));
  await writeFile(path.join(root, 'included', 'photo.jpg'), '');
  await writeFile(path.join(root, 'excluded', 'hidden.jpg'), '');
  const library = await openLibrary(root);
  const entries = await collect(
    library,
    library.startScan({
      directoryId: '.',
      excludeDirectoryIds: ['excluded'],
      metadata: true,
      recursive: true
    })
  );
  expect(entries.map((entry) => entry.id)).toEqual([
    'included',
    path.join('included', 'photo.jpg')
  ]);
  expect(entries.every((entry) => typeof entry.metadata?.createdMs === 'number')).toBe(true);
});

test('folder covers are shallow and child folders are reported independently', async () => {
  const root = await fixture();
  await mkdir(path.join(root, 'child'));
  await writeFile(path.join(root, 'child', 'nested.jpg'), '');
  await mkdir(path.join(root, 'empty'));
  const library = await openLibrary(root);
  expect(await library.inspectFolder('.')).toEqual({
    covers: [],
    hasEntries: true,
    hasSubfolders: true
  });
  expect(await library.inspectFolder('empty')).toEqual({
    covers: [],
    hasEntries: false,
    hasSubfolders: false
  });
  const child = await library.inspectFolder('child');
  expect(child.covers.map((cover) => cover.id)).toEqual([path.join('child', 'nested.jpg')]);
  expect(child.hasSubfolders).toBe(false);
});

test('scans reject overlapping pulls, release cancelled handles, and report missing directories', async () => {
  const root = await fixture();
  await writeFile(path.join(root, 'photo.jpg'), '');
  const library = await openLibrary(root);
  const scanId = library.startScan({ directoryId: '.' });
  const pending = library.nextBatch(scanId);
  await expect(library.nextBatch(scanId)).rejects.toThrow(/one batch/u);
  await pending;
  const cancelled = library.startScan({ directoryId: '.' });
  await library.cancelScan(cancelled);
  await expect(library.nextBatch(cancelled)).rejects.toThrow(/closed/u);
  const missing = await library.nextBatch(library.startScan({ directoryId: 'missing' }));
  expect(missing.done).toBe(true);
  expect(missing.errors).toHaveLength(1);
});

test('filesystem access rejects traversal and symlinks outside the selected root', async () => {
  const root = await fixture();
  const outside = await fixture();
  await image(path.join(outside, 'private.png'));
  await symlink(outside, path.join(root, 'outside'), 'dir');
  const library = await openLibrary(root);
  await expect(library.resolve('../escape')).rejects.toThrow(/outside/u);
  await expect(library.original(path.join('outside', 'private.png'))).rejects.toThrow(/outside/u);
  await expect(library.resolve(path.join(outside, 'private.png'))).rejects.toThrow(/outside/u);
});

test('thumbnail cache bounds dimensions, preserves small images, and versions changed sources', async () => {
  const root = await fixture();
  const source = path.join(root, 'photo.png');
  const directory = path.join(root, 'cache');
  const cache = new ThumbnailCache(directory);
  const { signal } = new AbortController();
  await image(source);
  const key = await cache.generate(source, signal);
  expect(await cache.generate(source, signal)).toBe(key);
  expect(await sharp(path.join(directory, `${key}.webp`)).metadata()).toMatchObject({
    height: 288,
    width: 384
  });
  await image(source, 80, 60);
  const changed = await cache.generate(source, signal);
  expect(changed).not.toBe(key);
  expect(await sharp(path.join(directory, `${changed}.webp`)).metadata()).toMatchObject({
    height: 60,
    width: 80
  });
  expect((await readdir(directory)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
});

test('queue shares work, cancels consumers independently, and skips cancelled queued jobs', async () => {
  const queue = new WorkQueue<number>(1, 4);
  const first = new AbortController();
  const second = new AbortController();
  const queued = new AbortController();
  let finish: (value: number) => void = vi.fn();
  const gate = new Promise<number>((resolve) => {
    finish = resolve;
  });
  const work = vi.fn(() => gate);
  const firstResult = queue.run('shared', first.signal, work);
  const firstCancelled = expect(firstResult).rejects.toThrow(/cancelled/u);
  const secondResult = queue.run('shared', second.signal, work);
  const unwanted = vi.fn(() => Promise.resolve(0));
  const unwantedResult = queue.run('offscreen', queued.signal, unwanted);
  const unwantedCancelled = expect(unwantedResult).rejects.toThrow(/cancelled/u);
  first.abort();
  queued.abort();
  finish(42);
  await expect(secondResult).resolves.toBe(42);
  await Promise.all([firstCancelled, unwantedCancelled]);
  expect(work).toHaveBeenCalledOnce();
  expect(unwanted).not.toHaveBeenCalled();
});

test('cache eviction enforces its disk budget', async () => {
  const root = await fixture();
  const file = path.join(root, `${'a'.repeat(64)}.webp`);
  await writeFile(file, 'cache');
  await new ThumbnailCache(root, 0).prune();
  await expect(stat(file)).rejects.toMatchObject({ code: 'ENOENT' });
});

test('backend cancellation crosses the API boundary and duplicate requests share an output', async () => {
  const root = await fixture();
  await image(path.join(root, 'photo.png'));
  const library = await openLibrary(root);
  const backend = createPhotoBackend(library, path.join(root, 'cache'));
  const cancelled = backend.requestThumbnail({
    entryId: 'photo.png',
    preset: 'grid',
    requestId: 'cancel'
  });
  backend.cancelThumbnail('cancel');
  await expect(cancelled).resolves.toEqual({ status: 'cancelled' });
  const results = await Promise.all(
    ['first', 'second'].map((requestId) =>
      backend.requestThumbnail({ entryId: 'photo.png', preset: 'grid', requestId })
    )
  );
  expect(results[0]?.status).toBe('ready');
  expect(results[0]).toEqual(results[1]);
});

test('videos are listed, cover folders, and open as originals', async () => {
  const root = await fixture();
  await writeFile(path.join(root, 'clip.MOV'), '');
  await writeFile(path.join(root, 'notes.txt'), '');
  const library = await openLibrary(root);
  const entries = await collect(library, library.startScan({ directoryId: '.' }));
  expect(Object.fromEntries(entries.map((entry) => [entry.name, entry.kind]))).toEqual({
    'clip.MOV': 'video',
    'notes.txt': 'file'
  });
  expect((await library.inspectFolder('.')).covers.map((cover) => cover.id)).toEqual(['clip.MOV']);
  expect(await library.original('clip.MOV')).toBe(path.join(await realpath(root), 'clip.MOV'));
  await expect(library.original('notes.txt')).rejects.toThrow(/not a supported/u);
});

/** Stands in for the system's thumbnailer, or for a still the window took. */
function still(_source: string, edge: number) {
  return sharp({ create: { background: '#000', channels: 3, height: edge / 2, width: edge } })
    .jpeg()
    .toBuffer();
}

test('the system renders stills of the videos it can read, and the window stores the rest', async () => {
  const root = await fixture();
  await writeFile(path.join(root, 'clip.mp4'), 'video');
  await writeFile(path.join(root, 'clip.webm'), 'video');
  const library = await openLibrary(root);
  const frame = vi.fn(still);
  const backend = createPhotoBackend(library, path.join(root, 'cache'), frame);
  const request = (entryId: string) =>
    backend.requestThumbnail({ entryId, preset: 'grid', requestId: entryId });

  await expect(request('clip.mp4')).resolves.toMatchObject({ status: 'ready' });
  expect(frame).toHaveBeenCalledOnce();
  expect(frame).toHaveBeenCalledWith(
    path.join(await realpath(root), 'clip.mp4'),
    384,
    expect.anything()
  );

  await expect(request('clip.webm')).resolves.toEqual({ status: 'frame-needed' });
  const stored = await backend.storeThumbnail({
    entryId: 'clip.webm',
    image: await still('', 384)
  });
  expect(stored.status).toBe('ready');
  await expect(request('clip.webm')).resolves.toEqual(stored);
  expect(frame).toHaveBeenCalledOnce();
  await expect(
    backend.storeThumbnail({ entryId: 'clip.webm', image: 'not bytes' as never })
  ).rejects.toThrow(/Invalid/u);
});

test('without a system thumbnailer, the window takes every video still', async () => {
  const root = await fixture();
  await writeFile(path.join(root, 'clip.mp4'), 'video');
  const library = await openLibrary(root);
  const backend = createPhotoBackend(library, path.join(root, 'cache'));
  await expect(
    backend.requestThumbnail({ entryId: 'clip.mp4', preset: 'grid', requestId: 'video' })
  ).resolves.toEqual({ status: 'frame-needed' });
});
