import { convertToJpeg } from '@prism/windows-imaging';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp, { type Sharp } from 'sharp';
import { expect, onTestFinished, test } from 'vitest';

const windows = process.platform === 'win32',
  RED = [255, 0, 0];

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'windows-imaging-'));
  onTestFinished(() => rm(root, { force: true, recursive: true }));
  return root;
}

/** How to store a picture so that each EXIF orientation shows it as it was. */
const STORED: ((image: Sharp) => Sharp)[] = [
  // Orientations count from 1.
  (image) => image,
  (image) => image,
  (image) => image.flop(),
  (image) => image.rotate(180),
  (image) => image.flip(),
  (image) => image.rotate(270).flop(),
  (image) => image.rotate(270),
  (image) => image.rotate(90).flop(),
  (image) => image.rotate(90),
];

/** A 200 by 100 picture, red in its top-left corner, stored as a JPEG of `orientation`. */
async function photo(file: string, orientation: number) {
  const corner = await sharp({ create: { background: '#f00', channels: 3, height: 40, width: 50 } })
    .png()
    .toBuffer();
  const upright = await sharp({
    create: { background: '#00f', channels: 3, height: 100, width: 200 },
  })
    .composite([{ input: corner, left: 0, top: 0 }])
    .png()
    .toBuffer();
  const store = STORED[orientation] ?? ((image: Sharp) => image);
  const stored = await store(sharp(upright)).png().toBuffer();
  await sharp(stored).jpeg({ quality: 100 }).withMetadata({ orientation }).toFile(file);
}

/** The colour `left` and `top` of the picture `jpeg` holds, applying no orientation. */
async function colour(jpeg: Uint8Array, left: number, top: number) {
  const { data, info } = await sharp(jpeg).raw().toBuffer({ resolveWithObject: true });
  const offset = (top * info.width + left) * info.channels;
  return [...data.subarray(offset, offset + 3)].map((value) => Math.round(value / 255) * 255);
}

test.runIf(windows).each([1, 2, 3, 4, 5, 6, 7, 8])(
  'a photo of orientation %i comes out upright',
  async (orientation) => {
    const file = path.join(await fixture(), 'photo.jpg');
    await photo(file, orientation);
    const jpeg = await convertToJpeg(file, 0.9);
    expect(await sharp(jpeg).metadata()).toMatchObject({ format: 'jpeg', height: 100, width: 200 });
    expect(await colour(jpeg, 10, 10)).toEqual(RED);
    expect(await colour(jpeg, 190, 90)).not.toEqual(RED);
  },
);

test.runIf(windows)('a file no codec reads fails with its HRESULT', async () => {
  const file = path.join(await fixture(), 'photo.heic');
  await writeFile(file, 'not a photo');
  await expect(convertToJpeg(file, 0.9)).rejects.toThrow(/^88982F50 /u);
});

test.skipIf(windows)('elsewhere, the addon is not built', async () => {
  await expect(convertToJpeg('photo.heic', 0.9)).rejects.toThrow(/Windows only/u);
});
