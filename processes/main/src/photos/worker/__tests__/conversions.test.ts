import { WorkerBackend } from '#photos/worker/backend';
import { PhotoLibrary } from '#photos/worker/library';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp, { type Sharp } from 'sharp';
import { expect, onTestFinished, test } from 'vitest';

async function backendFor(files: Record<string, Sharp>) {
  const root = await mkdtemp(path.join(tmpdir(), 'photo-conversions-'));
  onTestFinished(() => rm(root, { force: true, recursive: true }));
  await Promise.all(
    Object.entries(files).map(([name, image]) => image.toFile(path.join(root, name))),
  );
  const library = await PhotoLibrary.open(root);
  onTestFinished(() => library.close());
  return new WorkerBackend(library, path.join(root, 'cache'));
}

function blank(width: number, height: number, { alpha = 1, channels = 3 as 3 | 4 } = {}) {
  const background = `rgba(70, 120, 171, ${alpha})`;
  return sharp({ create: { background, channels, height, width } });
}

test('a TIFF photo opens as a full-size JPEG, turned upright', async () => {
  const backend = await backendFor({
    // Stored on its side, as a camera held upright writes it.
    'scan.tif': blank(800, 400).withMetadata({ orientation: 6 }).tiff(),
  });
  const converted = await backend.convertedOriginal('scan.tif');
  expect(converted.type).toBe('image/jpeg');
  expect(await sharp(converted.data).metadata()).toMatchObject({
    format: 'jpeg',
    height: 800,
    width: 400,
  });
  await expect(backend.convertedOriginal('scan.tif')).resolves.toBe(converted);
});

test('a transparent TIFF photo opens as a PNG, keeping its transparency', async () => {
  // Compressed losslessly, as sharp's TIFFs are otherwise JPEG inside, which drops the alpha.
  const backend = await backendFor({
    'cutout.TIFF': blank(64, 32, { alpha: 0.5, channels: 4 }).tiff({ compression: 'lzw' }),
    'opaque.tif': blank(64, 32, { channels: 4 }).tiff({ compression: 'lzw' }),
  });
  // An alpha channel that hides nothing makes a JPEG all the same.
  await expect(backend.convertedOriginal('opaque.tif')).resolves.toMatchObject({
    type: 'image/jpeg',
  });
  const converted = await backend.convertedOriginal('cutout.TIFF');
  expect(converted.type).toBe('image/png');
  expect(await sharp(converted.data).metadata()).toMatchObject({
    format: 'png',
    hasAlpha: true,
    height: 32,
    width: 64,
  });
});

test('only HEIF and TIFF photos are converted', async () => {
  const backend = await backendFor({ 'photo.png': blank(8, 8).png() });
  await expect(backend.convertedOriginal('photo.png')).rejects.toThrow(/Only HEIF and TIFF/u);
});
