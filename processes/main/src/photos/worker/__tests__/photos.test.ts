import { WorkerBackend } from '#photos/worker/backend';
import { PhotoLibrary } from '#photos/worker/library';
import { Catalog, type CatalogWrite } from '@prism/catalog';
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

/** The folder's own entries, which must all have been read. */
async function list(library: PhotoLibrary, directoryId: string) {
  const listing = await library.listFolder(directoryId);
  expect(listing.errors).toEqual([]);
  return listing.entries;
}

async function image(file: string, width = 800, height = 600) {
  await sharp({ create: { background: '#4678ab', channels: 3, height, width } })
    .png()
    .toFile(file);
}

test('a folder lists each entry once with its metadata, folders first, without symlinks', async () => {
  const root = await fixture();
  await Promise.all(
    Array.from({ length: 300 }, (_entry, index) => writeFile(path.join(root, `${index}.jpg`), '')),
  );
  await mkdir(path.join(root, 'b folder'));
  await symlink(root, path.join(root, 'loop'), 'dir');
  const library = await openLibrary(root);
  const entries = await list(library, '.');
  expect(entries).toHaveLength(301);
  expect(entries[0]).toMatchObject({ id: 'b folder', kind: 'directory' });
  expect(entries.slice(1, 4).map((entry) => entry.id)).toEqual(['0.jpg', '1.jpg', '2.jpg']);
  expect(entries.slice(1).every((entry) => entry.kind === 'image' && entry.metadata)).toBe(true);
});

test('a folder is read once a session, until it changes or the window refreshes', async () => {
  const root = await fixture();
  await writeFile(path.join(root, 'first.jpg'), '');
  const library = await openLibrary(root);
  expect(await list(library, '.')).toHaveLength(1);
  await writeFile(path.join(root, 'second.jpg'), '');
  expect(await list(library, '.')).toHaveLength(1);
  library.forget(['.']);
  expect(await list(library, '.')).toHaveLength(2);
});

test('a folder whose rows did not reach the catalog is read again', async () => {
  const root = await fixture();
  await writeFile(path.join(root, 'first.jpg'), '');
  let failing = true;
  const files = { index: ':memory:', ratings: ':memory:' };
  const library = await PhotoLibrary.open(root, files, (opened, at) => {
    const catalog = Catalog.inProcess(opened, at);
    const listeners = new Set<(writes: CatalogWrite[]) => void>();
    const write = catalog.write.bind(catalog);
    vi.spyOn(catalog, 'onWriteFailed').mockImplementation((listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    });
    vi.spyOn(catalog, 'write').mockImplementation((change) => {
      if (!failing) {
        return write(change);
      }
      queueMicrotask(() => {
        for (const listener of listeners) {
          listener([change]);
        }
      });
      return 0;
    });
    return catalog;
  });
  onTestFinished(() => library.close());
  expect(await list(library, '.')).toHaveLength(0);
  failing = false;
  expect(await list(library, '.')).toHaveLength(1);
});

test('a folder that cannot be read lists nothing, and says why', async () => {
  const root = await fixture();
  const library = await openLibrary(root);
  const missing = await library.listFolder('missing');
  expect(missing.entries).toEqual([]);
  expect(missing.error).toMatch(/ENOENT/u);
  expect(missing.errors).toHaveLength(1);
  expect(missing.missing).toBe(true);
  await expect(library.listFolder('../outside')).resolves.toMatchObject({
    error: expect.stringMatching(/outside/u),
    missing: false,
  });
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
  const backend = new WorkerBackend(library, path.join(root, 'cache'));
  const decode = vi.spyOn(sharp.prototype, 'toFile');
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

test('a cached thumbnail is found by its entry, without making one that is not', async () => {
  const root = await fixture();
  await image(path.join(root, 'photo.png'));
  const library = await openLibrary(root);
  const backend = new WorkerBackend(library, path.join(root, 'cache'));
  const decode = vi.spyOn(sharp.prototype, 'toFile');
  await expect(backend.cachedThumbnail('photo.png')).resolves.toBeNull();
  expect(decode).not.toHaveBeenCalled();
  decode.mockRestore();
  const made = await backend.requestThumbnail('photo.png');
  const key = await backend.cachedThumbnail('photo.png');
  expect(made).toEqual({ status: 'ready', url: `media://thumbnail/${key}.webp` });
});

test('videos are listed, and open as originals', async () => {
  const root = await fixture();
  await writeFile(path.join(root, 'clip.MOV'), '');
  await writeFile(path.join(root, 'notes.txt'), '');
  const library = await openLibrary(root);
  const entries = await list(library, '.');
  expect(Object.fromEntries(entries.map((entry) => [entry.name, entry.kind]))).toEqual({
    'clip.MOV': 'video',
    'notes.txt': 'file',
  });
  expect(await library.original('clip.MOV')).toBe(path.join(await realpath(root), 'clip.MOV'));
  await expect(library.original('notes.txt')).rejects.toThrow(/not a supported/u);
});

/** Stands in for the system's thumbnailer, or for a still the window took. */
function still(_source: string, { width, height }: { width: number; height: number }) {
  return sharp({ create: { background: '#000', channels: 3, height, width } })
    .jpeg()
    .toBuffer();
}

test('the system renders stills of the videos it can read, and the window stores the rest', async () => {
  const root = await fixture();
  await writeFile(path.join(root, 'clip.mp4'), 'video');
  await writeFile(path.join(root, 'clip.webm'), 'video');
  const library = await openLibrary(root);
  const frame = vi.fn(still);
  const backend = new WorkerBackend(library, path.join(root, 'cache'), frame);
  const request = (entryId: string) => backend.requestThumbnail(entryId);

  await expect(request('clip.mp4')).resolves.toMatchObject({ status: 'ready' });
  expect(frame).toHaveBeenCalledOnce();
  expect(frame).toHaveBeenCalledWith(
    path.join(await realpath(root), 'clip.mp4'),
    { height: 384, width: 384 },
    expect.anything(),
  );

  await expect(request('clip.webm')).resolves.toEqual({ status: 'frame-needed' });
  const stored = await backend.storeThumbnail({
    entryId: 'clip.webm',
    image: await still('', { height: 192, width: 384 }),
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
  const backend = new WorkerBackend(library, path.join(root, 'cache'));
  await expect(backend.requestThumbnail('clip.mp4')).resolves.toEqual({
    status: 'frame-needed',
  });
});
