import type { PhotoFile } from '@prism/catalog';
import { inodeOf, mediaKind, type ThumbnailSource } from '@prism/media';
import { stat } from 'node:fs/promises';
import path from 'node:path';

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
export async function statPhoto(root: string, id: string): Promise<PhotoFile> {
  const file = path.join(root, id);
  const info = await stat(file);
  return { file, id, inode: inodeOf(info), modifiedMs: info.mtimeMs, size: info.size };
}
