import { listable } from '#photos/media';
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
