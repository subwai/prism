import { listable, mediaKind, mediaType, systemRendersVideo } from '#kinds';
import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, onTestFinished, test } from 'vitest';

test('lists each name once, even when the system lists it again', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'photo-listing-'));
  onTestFinished(() => rm(root, { force: true, recursive: true }));
  await mkdir(path.join(root, 'Trips'));
  await writeFile(path.join(root, 'photo.jpg'), '');
  await writeFile(path.join(root, '.DS_Store'), '');
  await symlink(root, path.join(root, 'loop'), 'dir');
  const listing = await readdir(root, { withFileTypes: true });
  // A network share after its connection comes back.
  const repeated = [...listing, ...listing, ...listing];
  expect(
    listable(repeated)
      .map((dirent) => dirent.name)
      .toSorted(),
  ).toEqual(['Trips', 'photo.jpg']);
});

test('knows each file type the library shows by its extension, whatever its case', () => {
  expect(
    ['IMG_1.JPG', 'scan.tiff', 'clip.MOV', 'clip.webm', 'notes.txt'].map((file) => mediaKind(file)),
  ).toEqual(['image', 'image', 'video', 'video', null]);
  expect(
    ['IMG_1.JPG', 'clip.mov', 'thumb.webp', 'notes.txt'].map((file) => mediaType(file)),
  ).toEqual(['image/jpeg', 'video/quicktime', 'image/webp', 'application/octet-stream']);
  expect(['clip.mp4', 'clip.webm', 'photo.jpg'].map((file) => systemRendersVideo(file))).toEqual([
    true,
    false,
    false,
  ]);
});
