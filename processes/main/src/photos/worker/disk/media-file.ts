import type { PhotoFile } from '@prism/catalog';
import { inodeOf, mediaKind, type ThumbnailSource } from '@prism/media';
import { stat } from 'node:fs/promises';
import path from 'node:path';

// `stat` reads what the disk records of a file: its size, its times and its number on the disk.
// A file's inode is its number on its disk, which a rename or move keeps.

/**
 * Looks at the photo or video at `file` on disk, following links, for its size and times.
 * Rejects if it is not a file of a kind Prism shows.
 */
export async function lookAtMediaFile(file: string): Promise<ThumbnailSource> {
  const info = await stat(file);
  if (!mediaKind(file) || !info.isFile()) {
    throw new Error('Entry is not a supported photo or video.');
  }
  return { file, info };
}

/** The photo at `id` inside `root` as it is on disk now. */
export async function lookAtPhotoFile(root: string, id: string): Promise<PhotoFile> {
  const file = path.join(root, id);
  const info = await stat(file);
  return { file, id, inode: inodeOf(info), modifiedMs: info.mtimeMs, size: info.size };
}
