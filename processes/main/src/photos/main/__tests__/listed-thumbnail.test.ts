import { listedKeyOf, listedThumbnailFile } from '#photos/main/listed-thumbnail';
import { thumbnailCache, thumbnailFile, thumbnailKey } from '@prism/media';
import { cachedThumbnailURL, type PhotoEntry } from '@prism/shared';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, onTestFinished, test } from 'vitest';

/** A file named `name`, and the entry a listing of its folder makes of it. */
async function listed(name: string) {
  const root = await mkdtemp(path.join(tmpdir(), 'listed-thumbnail-'));
  onTestFinished(() => rm(root, { force: true, recursive: true }));
  const file = path.join(root, name);
  await writeFile(file, 'pixels');
  const info = await stat(file);
  const entry: PhotoEntry = {
    id: name,
    kind: 'image',
    metadata: {
      accessedMs: info.atimeMs,
      createdMs: info.birthtimeMs,
      inode: String(info.ino),
      modifiedMs: info.mtimeMs,
      size: info.size,
    },
    name,
    parentId: '.',
  };
  return { entry, file, info };
}

test('the URL of a listed entry names the thumbnail a look at its file would', async () => {
  for (const name of ['photo.jpg', 'clip.mp4']) {
    const { entry, file, info } = await listed(name);
    const url = new URL(cachedThumbnailURL('session', entry));
    expect(listedKeyOf(url, entry.id)).toBe(thumbnailKey({ file, info }, name.endsWith('.mp4')));
  }
});

/** The key the URL of `entry` names, if it says enough. */
function keyOf(entry: PhotoEntry) {
  const url = new URL(cachedThumbnailURL('session', entry));
  return listedKeyOf(url, entry.id);
}

test('an entry listed without an inode, or on a disk that reports none, is left to the worker', async () => {
  const { entry } = await listed('photo.jpg');
  const { inode: _inode, ...metadata } = entry.metadata ?? {};
  expect(keyOf({ ...entry, metadata } as PhotoEntry)).toBeNull();
  expect(keyOf({ ...entry, metadata: { ...metadata, inode: '0' } } as PhotoEntry)).toBeNull();
  expect(keyOf({ ...entry, metadata: undefined })).toBeNull();
});

test('the thumbnail a listed URL names is found in its subfolder, or moved there from the folder itself', async () => {
  const { entry, file } = await listed('photo.jpg');
  const cache = thumbnailCache(path.join(path.dirname(file), 'thumbnails'));
  const key = keyOf(entry) ?? '';
  await expect(listedThumbnailFile(cache, key)).resolves.toBeNull();

  // As versions before the subfolders kept it.
  const flat = path.join(cache.directory, `${key}.webp`);
  await mkdir(cache.directory, { recursive: true });
  await writeFile(flat, 'thumbnail');
  await expect(listedThumbnailFile(cache, key)).resolves.toBe(thumbnailFile(cache.directory, key));
  await expect(stat(flat)).rejects.toMatchObject({ code: 'ENOENT' });

  expect(path.relative(cache.directory, thumbnailFile(cache.directory, key))).toBe(
    path.join(key.slice(0, 2), `${key}.webp`),
  );
  await expect(listedThumbnailFile(cache, key)).resolves.toBe(thumbnailFile(cache.directory, key));
});
