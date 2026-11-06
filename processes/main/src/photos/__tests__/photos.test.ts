import { createPhotoBackend } from '#photos/backend';
import { PhotoLibrary } from '#photos/library';
import { ThumbnailCache } from '#photos/thumbnails';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
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

/** How many folders deep an entry is, counting the open folder's entries as 1. */
function depth(id: string) {
  return id.split(path.sep).length;
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
    Array.from({ length: 300 }, (_entry, index) => writeFile(path.join(root, `${index}.jpg`), '')),
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

test('recursive scans go breadth first and optionally include timestamps', async () => {
  const root = await fixture();
  await mkdir(path.join(root, 'a', 'deeper'), { recursive: true });
  await writeFile(path.join(root, 'a', 'deeper', 'deepest.jpg'), '');
  await writeFile(path.join(root, 'a', 'photo.jpg'), '');
  await writeFile(path.join(root, 'top.jpg'), '');
  const library = await openLibrary(root);
  const entries = await collect(
    library,
    library.startScan({ directoryId: '.', metadata: true, recursive: true }),
  );
  expect(entries.map((entry) => depth(entry.id))).toEqual([1, 1, 2, 2, 3]);
  expect(entries.map((entry) => entry.id).toSorted()).toEqual(
    [
      'a',
      path.join('a', 'deeper'),
      path.join('a', 'deeper', 'deepest.jpg'),
      path.join('a', 'photo.jpg'),
      'top.jpg',
    ].toSorted(),
  );
  expect(entries.every((entry) => typeof entry.metadata?.createdMs === 'number')).toBe(true);
});

test('recursive scans reach folders nested deeper than the old limit of 128', async () => {
  const root = await fixture();
  const levels = Array.from({ length: 140 }, () => 'd');
  await mkdir(path.join(root, ...levels), { recursive: true });
  await writeFile(path.join(root, ...levels, 'deep.jpg'), '');
  const library = await openLibrary(root);
  const entries = await collect(library, library.startScan({ directoryId: '.', recursive: true }));
  expect(entries.at(-1)?.id).toBe(path.join(...levels, 'deep.jpg'));
});

test('folders without photos of their own take covers from the shallowest folder inside', async () => {
  const root = await fixture();
  await mkdir(path.join(root, 'a', 'deeper'), { recursive: true });
  await mkdir(path.join(root, 'b'));
  await writeFile(path.join(root, 'a', 'deeper', 'deepest.jpg'), '');
  await writeFile(path.join(root, 'b', 'shallow.jpg'), '');
  await writeFile(path.join(root, 'b', 'clip.mp4'), '');
  await mkdir(path.join(root, 'empty'));
  const library = await openLibrary(root);
  expect(await library.inspectFolder('.')).toEqual({
    covers: [
      expect.objectContaining({ id: path.join('b', 'shallow.jpg') }),
      expect.objectContaining({ id: path.join('b', 'clip.mp4') }),
    ],
    hasEntries: true,
    hasSubfolders: true,
  });
  expect(await library.inspectFolder('empty')).toEqual({
    covers: [],
    hasEntries: false,
    hasSubfolders: false,
  });
  const folder = await library.inspectFolder('a');
  expect(folder.covers.map((cover) => cover.id)).toEqual([path.join('a', 'deeper', 'deepest.jpg')]);
  expect(folder.hasSubfolders).toBe(true);
});

test('folders of folders find covers past a wide layer of folders without photos', async () => {
  const root = await fixture();
  // A year of day folders: more folders a layer down than a cover search opens.
  for (let month = 1; month <= 12; month += 1) {
    for (let day = 1; day <= 25; day += 1) {
      await mkdir(path.join(root, '2024', `${month}`, `${day}`), { recursive: true });
    }
  }
  await writeFile(path.join(root, '2024', '1', '1', 'day.jpg'), '');
  const library = await openLibrary(root);
  expect((await library.inspectFolder('2024')).covers.map((cover) => cover.id)).toEqual([
    path.join('2024', '1', '1', 'day.jpg'),
  ]);
});

test('a summary read while its folder changed is not remembered', async () => {
  const root = await fixture();
  await mkdir(path.join(root, 'a'));
  const library = await openLibrary(root);
  const reading = library.inspectFolder('.');
  library.forget(['.']);
  expect((await reading).covers).toEqual([]);
  await writeFile(path.join(root, 'a', 'late.jpg'), '');
  expect((await library.inspectFolder('.')).covers.map((cover) => cover.id)).toEqual([
    path.join('a', 'late.jpg'),
  ]);
});

test('a folder with photos of its own keeps them as covers', async () => {
  const root = await fixture();
  await mkdir(path.join(root, 'child'));
  await writeFile(path.join(root, 'child', 'nested.jpg'), '');
  await writeFile(path.join(root, 'own.jpg'), '');
  const library = await openLibrary(root);
  expect((await library.inspectFolder('.')).covers.map((cover) => cover.id)).toEqual(['own.jpg']);
});

test('a change deep inside a folder replaces the cover it took from there', async () => {
  const root = await fixture();
  await mkdir(path.join(root, 'a', 'deeper'), { recursive: true });
  await writeFile(path.join(root, 'a', 'deeper', 'first.jpg'), '');
  const library = await openLibrary(root);
  // Listing the folder, as the window does when it opens it, leaves the deeper cover alone.
  await collect(library, library.startScan({ directoryId: 'a' }));
  expect((await library.inspectFolder('.')).covers).toHaveLength(1);
  await rm(path.join(root, 'a', 'deeper', 'first.jpg'));
  await library.describeChanges([
    { id: path.join('a', 'deeper', 'first.jpg'), parentId: path.join('a', 'deeper') },
  ]);
  expect((await library.inspectFolder('.')).covers).toEqual([]);
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

test('duplicate thumbnail requests share an output, and cached ones skip decoding', async () => {
  const root = await fixture();
  await image(path.join(root, 'photo.png'));
  const library = await openLibrary(root);
  const backend = createPhotoBackend(library, path.join(root, 'cache'));
  const decode = vi.spyOn(ThumbnailCache.prototype, 'generate');
  const results = await Promise.all([
    backend.requestThumbnail('photo.png'),
    backend.requestThumbnail('photo.png'),
  ]);
  expect(results[0]?.status).toBe('ready');
  expect(results[0]).toEqual(results[1]);
  await expect(backend.requestThumbnail('photo.png')).resolves.toEqual(results[0]);
  expect(decode).toHaveBeenCalledOnce();
  decode.mockRestore();
});

test('folder summaries are kept until the folder changes or the window refreshes', async () => {
  const root = await fixture();
  const library = await openLibrary(root);
  await expect(library.inspectFolder('.')).resolves.toMatchObject({ hasEntries: false });
  await writeFile(path.join(root, 'new.jpg'), '');
  await expect(library.inspectFolder('.')).resolves.toMatchObject({ hasEntries: false });
  library.forget();
  await expect(library.inspectFolder('.')).resolves.toMatchObject({ hasEntries: true });
});

test('videos are listed, cover folders, and open as originals', async () => {
  const root = await fixture();
  await writeFile(path.join(root, 'clip.MOV'), '');
  await writeFile(path.join(root, 'notes.txt'), '');
  const library = await openLibrary(root);
  const entries = await collect(library, library.startScan({ directoryId: '.' }));
  expect(Object.fromEntries(entries.map((entry) => [entry.name, entry.kind]))).toEqual({
    'clip.MOV': 'video',
    'notes.txt': 'file',
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
  const request = (entryId: string) => backend.requestThumbnail(entryId);

  await expect(request('clip.mp4')).resolves.toMatchObject({ status: 'ready' });
  expect(frame).toHaveBeenCalledOnce();
  expect(frame).toHaveBeenCalledWith(
    path.join(await realpath(root), 'clip.mp4'),
    384,
    expect.anything(),
  );

  await expect(request('clip.webm')).resolves.toEqual({ status: 'frame-needed' });
  const stored = await backend.storeThumbnail({
    entryId: 'clip.webm',
    image: await still('', 384),
  });
  expect(stored.status).toBe('ready');
  await expect(request('clip.webm')).resolves.toEqual(stored);
  expect(frame).toHaveBeenCalledOnce();
  await expect(
    backend.storeThumbnail({ entryId: 'clip.webm', image: 'not bytes' as never }),
  ).rejects.toThrow(/Invalid/u);
});

test('without a system thumbnailer, the window takes every video still', async () => {
  const root = await fixture();
  await writeFile(path.join(root, 'clip.mp4'), 'video');
  const library = await openLibrary(root);
  const backend = createPhotoBackend(library, path.join(root, 'cache'));
  await expect(backend.requestThumbnail('clip.mp4')).resolves.toEqual({
    status: 'frame-needed',
  });
});
