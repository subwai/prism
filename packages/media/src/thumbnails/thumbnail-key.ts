import { createHash } from 'node:crypto';
import type { Stats } from 'node:fs';

// How thumbnails are made. Each of these is part of every thumbnail's key, so changing one
// makes new thumbnails rather than showing old ones made another way.
export const QUALITY = 75;
// WebP's encoding effort, from 0 to 6: images this small lose little to a quicker encode.
export const EFFORT = 2;
export const THUMBNAIL_EDGE = 384;
const PIPELINE = 'webp-v4';

/** A photo or video as it was when its thumbnail was asked for. */
export interface ThumbnailSource {
  file: string;
  info: Stats;
}

/** A photo or video as a listing of its folder described it, which is enough to name its thumbnail. */
export interface ListedFile {
  /** Its canonical path. */
  file: string;
  /** As `inodeOf` spells it. */
  inode: string;
  size: number;
  modifiedMs: number;
}

/** A file's inode as thumbnails' names and the catalog spell it: `'0'` where the disk reports none. */
export function inodeOf(info: Pick<Stats, 'ino'>): string {
  return String(info.ino);
}

/**
 * Names the thumbnail of `source`, or of a still from it if it is a `video`.
 *
 * A file is known by its inode rather than its path, so renaming it, or a folder holding it,
 * keeps its thumbnail. Some network disks report no inode, so those files go by path. The
 * device is left out: the system numbers a volume afresh each time it mounts, so a network
 * share that reconnects, or a disk plugged in again, would lose every thumbnail. Two volumes'
 * files can share an inode, but hardly their size and modification time to the fraction of a
 * millisecond as well.
 *
 * Whenever this changes, or `PIPELINE` does, raise the version of `THUMBNAIL_DIRECTORY_NAME` in
 * the main process's `thumbnail-directory.ts`.
 */
export function thumbnailKey({ file, info }: ThumbnailSource, video: boolean): string {
  return listedThumbnailKey(
    { file, inode: inodeOf(info), modifiedMs: info.mtimeMs, size: info.size },
    video,
  );
}

/**
 * `thumbnailKey`, from what a listing of the file said rather than a look at it now, so a
 * cached thumbnail is found without the disk the photo is on.
 */
export function listedThumbnailKey(
  { file, inode, size, modifiedMs }: ListedFile,
  video: boolean,
): string {
  const identity = inode === '0' ? file : `ino:${inode}`;
  return createHash('sha256')
    .update(
      JSON.stringify([
        identity,
        size,
        modifiedMs,
        THUMBNAIL_EDGE,
        QUALITY,
        video ? `${PIPELINE}-video` : PIPELINE,
      ]),
    )
    .digest('hex');
}
