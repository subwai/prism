import { openWindow } from '#photos/worker/__tests__/window';
import { PhotoLibrary } from '#photos/worker/library/library';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { expect, onTestFinished, test } from 'vitest';

/** A folder holding `photo.png`, open as a library, and a window on it. */
async function folder() {
  const root = await mkdtemp(path.join(tmpdir(), 'photo-cached-'));
  onTestFinished(() => rm(root, { force: true, recursive: true }));
  const file = path.join(root, 'photo.png');
  await sharp({ create: { background: '#4678ab', channels: 3, height: 60, width: 80 } })
    .png()
    .toFile(file);
  const library = PhotoLibrary.open(await realpath(root));
  onTestFinished(() => library.close());
  return { ...openWindow(library, path.join(root, 'cache')), file, library };
}

test('a cached thumbnail of a listed photo is found without the disk the photo is on', async () => {
  const { backend, file, library, thumbnail } = await folder();
  await library.readFolder('.');
  await thumbnail('photo.png');
  const key = await backend.cachedThumbnail('photo.png');
  expect(key).toMatch(/^[a-f\d]{64}$/u);
  // Gone, as a share that stopped answering: only the catalog's listing can name it now.
  await rm(file);
  await expect(backend.cachedThumbnail('photo.png')).resolves.toBe(key);
});

test('a listed photo and one looked at on disk name the same thumbnail', async () => {
  const { backend, library, thumbnail } = await folder();
  // Not listed yet, so the photo itself is looked at.
  const made = await thumbnail('photo.png');
  const onDisk = await backend.cachedThumbnail('photo.png');
  await library.readFolder('.');
  const listed = await backend.cachedThumbnail('photo.png');
  expect(listed).toBe(onDisk);
  expect(made).toEqual({ status: 'ready', url: `media://thumbnail/${listed}.webp` });
});
