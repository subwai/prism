import { createHash, randomUUID } from 'node:crypto';
import type { Stats } from 'node:fs';
import { copyFile, mkdir, readdir, rename, rm, stat, utimes } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

/** The most pixels a photo is decoded with; larger ones are refused. */
export const MAX_INPUT_PIXELS = 100_000_000;

const QUALITY = 75;
// WebP's encoding effort, from 0 to 6: images this small lose little to a quicker encode.
const EFFORT = 2;
const THUMBNAIL_EDGE = 384;
const PIPELINE = 'webp-v3';
const CACHE_BUDGET_BYTES = 512 * 1024 * 1024;
// Pruning reads the size of every cached file, so it waits until this much more is written.
const PRUNE_AFTER_BYTES = CACHE_BUDGET_BYTES / 20;
const STALE_TEMPORARY_MS = 60_000;
// Pruning removes the files used longest ago; a hit marks its file as used this often at most.
const TOUCH_AFTER_MS = 24 * 60 * 60 * 1000;

/** Whether `error` says a file or folder does not exist. */
function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

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
  const identity = info.ino ? `ino:${info.ino}` : file;
  return createHash('sha256')
    .update(
      JSON.stringify([
        identity,
        info.size,
        info.mtimeMs,
        THUMBNAIL_EDGE,
        QUALITY,
        video ? `${PIPELINE}-video` : PIPELINE,
      ]),
    )
    .digest('hex');
}

// Image-level parallelism is bounded separately by the work queue.
sharp.concurrency(1);
sharp.cache({ files: 0, items: 64, memory: 32 });

/** A folder of cached thumbnails, and what was written to it since it was last pruned. */
export interface ThumbnailCache {
  readonly directory: string;
  /** The bytes pruning keeps the folder within. */
  readonly budget: number;
  written: number;
  pruning: Promise<void> | undefined;
}

export function thumbnailCache(directory: string, budget = CACHE_BUDGET_BYTES): ThumbnailCache {
  // The first write prunes, catching up with what earlier sessions wrote.
  return { budget, directory, pruning: undefined, written: PRUNE_AFTER_BYTES };
}

function fileOf(cache: ThumbnailCache, key: string) {
  return path.join(cache.directory, `${key}.webp`);
}

/** Whether thumbnail `key` is cached; marks it as used. */
export async function hasThumbnail(cache: ThumbnailCache, key: string): Promise<boolean> {
  const file = fileOf(cache, key);
  try {
    const info = await stat(file);
    if (Date.now() - info.mtimeMs > TOUCH_AFTER_MS) {
      const now = new Date();
      // Pruning may remove it meanwhile, which only means it is generated again.
      await utimes(file, now, now).catch(() => null);
    }
    return true;
  } catch (error) {
    if (isMissing(error)) {
      return false;
    }
    throw error;
  }
}

/**
 * Keeps thumbnail `from` as `to` too, for a file rewritten without changing its pixels, as
 * writing a rating does. Nothing happens if `from` is not cached.
 */
export async function carryThumbnail(
  cache: ThumbnailCache,
  from: string,
  to: string,
): Promise<void> {
  if (from === to || !(await hasThumbnail(cache, from))) {
    return;
  }
  const temporary = path.join(cache.directory, `${to}.${randomUUID()}.tmp`);
  try {
    await copyFile(fileOf(cache, from), temporary);
    await rename(temporary, fileOf(cache, to));
  } finally {
    await rm(temporary, { force: true });
  }
}

/** Removes the files used longest ago until the cache fits its budget, and stale temporaries. */
export async function pruneThumbnails(cache: ThumbnailCache): Promise<void> {
  const files: { file: string; size: number; modified: number }[] = [];
  // One stat at a time keeps cache maintenance from flooding the filesystem pool.
  for (const name of await readdir(cache.directory).catch(() => [])) {
    const file = path.join(cache.directory, name);
    if (/^[a-f\d]{64}\.webp$/u.test(name)) {
      try {
        const info = await stat(file);
        files.push({ file, modified: info.mtimeMs, size: info.size });
      } catch {
        // Another cleanup or the user can remove a cache file at any time.
      }
    } else if (name.endsWith('.tmp')) {
      const info = await stat(file).catch(() => null);
      if (info && Date.now() - info.mtimeMs > STALE_TEMPORARY_MS) {
        await rm(file, { force: true });
      }
    }
  }
  let bytes = files.reduce((total, file) => total + file.size, 0);
  for (const file of files.toSorted((left, right) => left.modified - right.modified)) {
    if (bytes <= cache.budget) {
      break;
    }
    await rm(file.file, { force: true });
    bytes -= file.size;
  }
}

/** Counts `bytes` written, pruning once enough are, one prune at a time. */
function wrote(cache: ThumbnailCache, bytes: number) {
  cache.written += bytes;
  if (cache.pruning || cache.written < PRUNE_AFTER_BYTES) {
    return;
  }
  cache.written = 0;
  cache.pruning = pruneThumbnails(cache)
    .catch((error: unknown) =>
      process.emitWarning(`Thumbnail cache cleanup failed: ${String(error)}`),
    )
    .finally(() => {
      cache.pruning = undefined;
    });
}

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
  const temporary = path.join(cache.directory, `${key}.${randomUUID()}.tmp`);
  try {
    const input = frame
      ? await frame(source.file, { height: THUMBNAIL_EDGE, width: THUMBNAIL_EDGE }, signal)
      : source.file;
    signal.throwIfAborted();
    const { size } = await sharp(input, {
      limitInputPixels: MAX_INPUT_PIXELS,
      sequentialRead: true,
    })
      .autoOrient()
      .resize({
        fit: 'inside',
        height: THUMBNAIL_EDGE,
        width: THUMBNAIL_EDGE,
        withoutEnlargement: true,
      })
      .webp({ effort: EFFORT, quality: QUALITY })
      .toFile(temporary);
    const after = await stat(source.file);
    if (after.size !== source.info.size || after.mtimeMs !== source.info.mtimeMs) {
      throw new Error('Source changed during thumbnail generation; retry the request.');
    }
    await rename(temporary, fileOf(cache, key));
    wrote(cache, size);
  } finally {
    await rm(temporary, { force: true });
  }
}
