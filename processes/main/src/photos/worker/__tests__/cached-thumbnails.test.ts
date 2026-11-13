import { WorkerBackend } from '#photos/worker/backend';
import { PhotoLibrary } from '#photos/worker/library';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { expect, onTestFinished, test } from 'vitest';

/** A folder holding `photo.png`, open as a library, and the worker's backend for it. */
async function folder() {
  const root = await mkdtemp(path.join(tmpdir(), 'photo-cached-'));
  onTestFinished(() => rm(root, { force: true, recursive: true }));
  const file = path.join(root, 'photo.png');
  await sharp({ create: { background: '#4678ab', channels: 3, height: 60, width: 80 } })
    .png()
    .toFile(file);
  const library = await PhotoLibrary.open(root);
  onTestFinished(() => library.close());
  return { backend: new WorkerBackend(library, path.join(root, 'cache')), file, library };
}

test('a cached thumbnail of a listed photo is found without the disk the photo is on', async () => {
  const { backend, file, library } = await folder();
  await library.listFolder('.');
  await backend.requestThumbnail('photo.png');
  const key = await backend.cachedThumbnail('photo.png');
  expect(key).toMatch(/^[a-f\d]{64}$/u);
  // Gone, as a share that stopped answering: only the catalog's listing can name it now.
  await rm(file);
  await expect(backend.cachedThumbnail('photo.png')).resolves.toBe(key);
});

test('a listed photo and one looked at on disk name the same thumbnail', async () => {
  const { backend, library } = await folder();
  // Not listed yet, so the photo itself is looked at.
  const made = await backend.requestThumbnail('photo.png');
  const onDisk = await backend.cachedThumbnail('photo.png');
  await library.listFolder('.');
  const listed = await backend.cachedThumbnail('photo.png');
  expect(listed).toBe(onDisk);
  expect(made).toEqual({ status: 'ready', url: `media://thumbnail/${listed}.webp` });
});
