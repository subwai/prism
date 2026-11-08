import { createPhotoBackend } from '#photos/backend';
import { PhotoLibrary } from '#photos/library';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
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
  'a HEIF photo opens as a full-size JPEG the system converted',
  async () => {
    const root = await fixture();
    await heif(path.join(root, 'photo.heic'), 800, 400);
    const library = await openLibrary(root);
    const backend = createPhotoBackend(library, path.join(root, 'cache'));
    const converted = await backend.original('photo.heic');
    expect(path.dirname(converted)).toBe(path.join(root, 'cache'));
    expect(await sharp(converted).metadata()).toMatchObject({
      format: 'jpeg',
      height: 400,
      width: 800,
    });
    await expect(backend.original('photo.heic')).resolves.toBe(converted);
  },
);
