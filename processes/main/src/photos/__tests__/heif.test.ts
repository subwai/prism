import { createPhotoBackend } from '#photos/backend';
import { PhotoLibrary } from '#photos/library';
import { mkdtemp, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { expect, onTestFinished, test, vi } from 'vitest';

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'photo-heif-'));
  onTestFinished(() => rm(root, { force: true, recursive: true }));
  return root;
}

async function openLibrary(root: string) {
  const library = await PhotoLibrary.open(root);
  onTestFinished(() => library.close());
  return library;
}

/** Stands in for the system's thumbnailer. */
function still(_source: string, { width, height }: { width: number; height: number }) {
  return sharp({ create: { background: '#000', channels: 3, height, width } })
    .jpeg()
    .toBuffer();
}

/** What the system's thumbnailer answers with for a file it cannot read: its icon. */
function icon() {
  return sharp({ create: { background: '#0000', channels: 4, height: 64, width: 64 } })
    .png()
    .toBuffer();
}

/** A HEIF photo, `width` by `height`, compressed as AV1 since sharp's build cannot write HEVC. */
async function heif(file: string, width: number, height: number) {
  await sharp({ create: { background: '#4678ab', channels: 3, height, width } })
    .heif({ compression: 'av1' })
    .toFile(file);
}

test('the system renders thumbnails of HEIF photos, in their own shape', async () => {
  const root = await fixture();
  await heif(path.join(root, 'photo.HEIC'), 800, 400);
  const library = await openLibrary(root);
  const frame = vi.fn(still);
  const backend = createPhotoBackend(library, path.join(root, 'cache'), frame);
  await expect(backend.requestThumbnail('photo.HEIC')).resolves.toMatchObject({ status: 'ready' });
  expect(frame).toHaveBeenCalledWith(
    path.join(await realpath(root), 'photo.HEIC'),
    { height: 192, width: 384 },
    expect.anything(),
  );
});

test('a HEIF photo the system answers with an icon for, or has no thumbnailer for, fails', async () => {
  const root = await fixture();
  await heif(path.join(root, 'photo.heic'), 800, 400);
  const library = await openLibrary(root);
  const answered = createPhotoBackend(library, path.join(root, 'cache'), icon);
  await expect(answered.requestThumbnail('photo.heic')).resolves.toMatchObject({
    status: 'failed',
  });
  const unanswered = createPhotoBackend(library, path.join(root, 'cache'));
  await expect(unanswered.requestThumbnail('photo.heic')).resolves.toEqual({
    message: 'HEIC photos can be shown on macOS and Windows only.',
    status: 'failed',
  });
});

test.runIf(process.platform === 'darwin')(
  'a HEIF photo opens as a full-size JPEG the system converted, kept in memory',
  async () => {
    const root = await fixture();
    const file = path.join(root, 'photo.heic');
    await heif(file, 800, 400);
    const library = await openLibrary(root);
    const backend = createPhotoBackend(library, path.join(root, 'cache'));
    const converted = await backend.heifOriginal('photo.heic');
    expect(await sharp(converted).metadata()).toMatchObject({
      format: 'jpeg',
      height: 400,
      width: 800,
    });
    // Converted once, and not written to the cache, where it would crowd out thumbnails.
    await expect(backend.heifOriginal('photo.heic')).resolves.toBe(converted);
    await expect(readdir(root)).resolves.toEqual(['photo.heic']);
    // A changed photo is converted again.
    await heif(file, 300, 600);
    await expect(sharp(await backend.heifOriginal('photo.heic')).metadata()).resolves.toMatchObject(
      {
        height: 600,
        width: 300,
      },
    );
  },
);

test('only HEIF photos are converted', async () => {
  const root = await fixture();
  await sharp({ create: { background: '#000', channels: 3, height: 8, width: 8 } })
    .png()
    .toFile(path.join(root, 'photo.png'));
  const backend = createPhotoBackend(await openLibrary(root), path.join(root, 'cache'));
  await expect(backend.heifOriginal('photo.png')).rejects.toThrow(/Only HEIF/u);
});
