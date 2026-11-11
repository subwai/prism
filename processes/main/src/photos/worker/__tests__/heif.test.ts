import { WorkerBackend } from '#photos/worker/backend';
import { PhotoLibrary } from '#photos/worker/library';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
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

/** A HEIF photo, `width` by `height`, compressed as AV1 since sharp's build cannot write HEVC. */
async function heif(file: string, width: number, height: number) {
  await sharp({ create: { background: '#4678ab', channels: 3, height, width } })
    .heif({ compression: 'av1' })
    .toFile(file);
}

test.runIf(process.platform === 'darwin')(
  "a HEIF photo's thumbnail is the full-size JPEG the viewer shows, shrunk",
  async () => {
    const root = await fixture();
    await heif(path.join(root, 'photo.HEIC'), 800, 400);
    const library = await openLibrary(root);
    // The system's thumbnailer, which videos' stills come from, is left alone.
    const frame = vi.fn();
    const cache = path.join(root, 'cache');
    const backend = new WorkerBackend(library, cache, frame);
    const result = await backend.requestThumbnail('photo.HEIC');
    expect(result).toMatchObject({ status: 'ready' });
    const file = path.join(cache, path.basename(result.status === 'ready' ? result.url : ''));
    await expect(sharp(file).metadata()).resolves.toMatchObject({ height: 192, width: 384 });
    expect(frame).not.toHaveBeenCalled();
  },
);

test('a HEIF photo the system cannot read gets no thumbnail', async () => {
  const root = await fixture();
  await writeFile(path.join(root, 'photo.heic'), 'not a photo');
  const library = await openLibrary(root);
  const backend = new WorkerBackend(library, path.join(root, 'cache'));
  await expect(backend.requestThumbnail('photo.heic')).resolves.toMatchObject({
    status: 'failed',
  });
});

test.skipIf(process.platform === 'darwin' || process.platform === 'win32')(
  'elsewhere, a HEIF photo gets no thumbnail',
  async () => {
    const root = await fixture();
    await heif(path.join(root, 'photo.heic'), 800, 400);
    const library = await openLibrary(root);
    const backend = new WorkerBackend(library, path.join(root, 'cache'));
    await expect(backend.requestThumbnail('photo.heic')).resolves.toEqual({
      message: 'HEIC photos can be shown on macOS and Windows only.',
      status: 'failed',
    });
  },
);

test.runIf(process.platform === 'darwin')(
  'a HEIF photo opens as a full-size JPEG the system converted, kept in memory',
  async () => {
    const root = await fixture();
    const file = path.join(root, 'photo.heic');
    await heif(file, 800, 400);
    const library = await openLibrary(root);
    const backend = new WorkerBackend(library, path.join(root, 'cache'));
    const converted = await backend.convertedOriginal('photo.heic');
    expect(converted.type).toBe('image/jpeg');
    expect(await sharp(converted.data).metadata()).toMatchObject({
      format: 'jpeg',
      height: 400,
      width: 800,
    });
    // Converted once, and not written to the cache, where it would crowd out thumbnails.
    await expect(backend.convertedOriginal('photo.heic')).resolves.toBe(converted);
    await expect(readdir(root)).resolves.toEqual(['photo.heic']);
    // A changed photo is converted again.
    await heif(file, 300, 600);
    const changed = await backend.convertedOriginal('photo.heic');
    await expect(sharp(changed.data).metadata()).resolves.toMatchObject({
      height: 600,
      width: 300,
    });
  },
);
