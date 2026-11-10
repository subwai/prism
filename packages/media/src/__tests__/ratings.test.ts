import { readExif } from '#exif';
import { closeExifTool, ratingFrom, writeRating } from '#ratings';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, expect, onTestFinished, test } from 'vitest';

afterAll(() => closeExifTool());

async function photo(name: string) {
  const root = await mkdtemp(path.join(tmpdir(), 'photo-ratings-'));
  onTestFinished(() => rm(root, { force: true, recursive: true }));
  const file = path.join(root, name);
  const image = sharp({ create: { background: 'red', channels: 3, height: 8, width: 8 } });
  await image.toFormat(path.extname(name).slice(1) as 'jpeg').toFile(file);
  return file;
}

test('ratings are whole numbers of stars from one to five', () => {
  expect(ratingFrom(3)).toBe(3);
  expect(ratingFrom('5')).toBe(5);
  // XMP's 0 is no rating, -1 rejected; Windows' percentages are not stars either.
  expect([0, -1, 75, 2.5, null].map((value) => ratingFrom(value))).toEqual([
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
  ]);
});

test.each(['jpeg', 'png', 'tiff', 'webp', 'avif', 'gif'])(
  'a rating written into a %s photo is read back with its details, and taken away again',
  async (format) => {
    const file = await photo(`photo.${format}`);
    const before = await stat(file);
    await writeRating(file, 4);
    expect((await readExif(file)).rating).toBe(4);
    // Rewritten in place, so it keeps its place on disk.
    expect((await stat(file)).ino).toBe(before.ino);
    await writeRating(file, null);
    expect((await readExif(file)).rating).toBeUndefined();
  },
);
