import { keepThumbnail, temporaryFile, type ThumbnailCache } from '#thumbnail-cache';
import { createHash } from 'node:crypto';
import type { Stats } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import sharp, { type SharpOptions } from 'sharp';

/**
 * How photos are decoded: those over 100 megapixels are refused, and a damaged one shows what
 * can be read of it, as Chromium shows a JPEG cut short. Sharp's default fails on any warning,
 * and libvips warns of a truncated JPEG, so such a photo had no thumbnail at all.
 */
export const DECODING: SharpOptions = { failOn: 'none', limitInputPixels: 100_000_000 };

const QUALITY = 75;
// WebP's encoding effort, from 0 to 6: images this small lose little to a quicker encode.
const EFFORT = 2;
const THUMBNAIL_EDGE = 384;
const PIPELINE = 'webp-v4';

/** Renders a still of a video or photo as an encoded image, about `size` pixels. */
export type FrameReader = (
  source: string,
  size: { width: number; height: number },
  signal: AbortSignal,
) => Promise<Uint8Array>;

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
 * Raise the version of `THUMBNAIL_DIRECTORY_NAME`, in the main process's `thumbnail-directory.ts`,
 * whenever this changes, or `PIPELINE` does.
 *
 * Names the thumbnail of `source`, or of a still from it if it is a `video`. A file is known by
 * its inode rather than its path, so renaming it, or a folder holding it, keeps its thumbnail;
 * some network disks report none, so those go by path. The device is left out: the system
 * numbers a volume afresh each time it mounts, so a network share that reconnects, or a disk
 * plugged in again, would lose every thumbnail. Two volumes' files share an inode, but hardly
 * their size and modification time to the fraction of a millisecond as well.
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

// Image-level parallelism is bounded separately by the worker's scheduler; see `THREAD_POOL_SIZE`.
// More threads per image measured no faster, as decoding a shrunk JPEG uses one anyway.
sharp.concurrency(1);
// Every thumbnail reads a different file, so the cache rarely helps; holding no files open
// leaves them free to rename, move to the Trash or unmount.
sharp.cache({ files: 0, items: 64, memory: 32 });

/** Renders thumbnail `key` of `source`, or of the still that `frame` reads from it. */
export async function generateThumbnail(
  cache: ThumbnailCache,
  source: ThumbnailSource,
  key: string,
  signal: AbortSignal,
  frame?: FrameReader,
): Promise<void> {
  signal.throwIfAborted();
  // Created for each write, as resetting the cache deletes the folder.
  await mkdir(cache.directory, { recursive: true });
  const temporary = temporaryFile(cache, key);
  try {
    const input = frame
      ? await frame(source.file, { height: THUMBNAIL_EDGE, width: THUMBNAIL_EDGE }, signal)
      : source.file;
    signal.throwIfAborted();
    const { size } = await sharp(input, DECODING)
      .autoOrient()
      .resize({
        fit: 'inside',
        height: THUMBNAIL_EDGE,
        width: THUMBNAIL_EDGE,
        withoutEnlargement: true,
      })
      // Sharp converts to sRGB otherwise, so a wide-gamut photo's thumbnail looked duller than
      // the original the viewer swaps it for. Display P3 holds what phones and most cameras
      // capture, and its profile is only half a kilobyte.
      .withIccProfile('p3')
      .webp({ effort: EFFORT, quality: QUALITY })
      .toFile(temporary);
    const after = await stat(source.file);
    if (after.size !== source.info.size || after.mtimeMs !== source.info.mtimeMs) {
      throw new Error('Source changed during thumbnail generation; retry the request.');
    }
    await keepThumbnail(cache, temporary, key, size);
  } finally {
    await rm(temporary, { force: true });
  }
}
