import { createHash, randomUUID } from 'node:crypto';
import type { Stats } from 'node:fs';
import { mkdir, readdir, rename, rm, stat, utimes } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const MAX_INPUT_PIXELS = 100_000_000,
  QUALITY = 75,
  // WebP's encoding effort, from 0 to 6: images this small lose little to a quicker encode.
  EFFORT = 2,
  THUMBNAIL_EDGE = 384,
  PIPELINE = 'webp-v2',
  CACHE_BUDGET_BYTES = 512 * 1024 * 1024,
  // Pruning reads the size of every cached file, so it waits until this much more is written.
  PRUNE_AFTER_BYTES = CACHE_BUDGET_BYTES / 20,
  STALE_TEMPORARY_MS = 60_000,
  // Pruning removes the files used longest ago; a hit marks its file as used this often at most.
  TOUCH_AFTER_MS = 24 * 60 * 60 * 1000;

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

/** Thumbnails on disk, within a budget that pruning keeps them to, used longest ago first. */
export interface ThumbnailCache {
  readonly directory: string;
  /** Whether thumbnail `key` is cached; marks it as used. */
  has: (key: string) => Promise<boolean>;
  /** Renders thumbnail `key` of `source`, or of the still that `frame` reads from it. */
  generate: (
    source: ThumbnailSource,
    key: string,
    signal: AbortSignal,
    frame?: FrameReader,
  ) => Promise<void>;
  prune: () => Promise<void>;
}

/** Removes the cached thumbnails in `directory` used longest ago, until they fit `budget`. */
async function pruneThumbnails(directory: string, budget: number): Promise<void> {
  const files: { file: string; size: number; modified: number }[] = [];
  // One stat at a time keeps cache maintenance from flooding the filesystem pool.
  for (const name of await readdir(directory).catch(() => [])) {
    const file = path.join(directory, name);
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
    if (bytes <= budget) {
      break;
    }
    await rm(file.file, { force: true });
    bytes -= file.size;
  }
}

/** Renders a thumbnail of `input` into the file `target`, returning its size in bytes. */
async function renderThumbnail(input: string | Uint8Array, target: string): Promise<number> {
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
    .toFile(target);
  return size;
}

export function createThumbnailCache(
  directory: string,
  budget = CACHE_BUDGET_BYTES,
): ThumbnailCache {
  // Image-level parallelism is bounded separately by the work queue.
  sharp.concurrency(1);
  sharp.cache({ files: 0, items: 64, memory: 32 });
  // The first write prunes, catching up with what earlier sessions wrote.
  let written = PRUNE_AFTER_BYTES;
  let pruning: Promise<void> | undefined;
  const fileOf = (key: string) => path.join(directory, `${key}.webp`);
  const prune = () => pruneThumbnails(directory, budget);

  function wrote(bytes: number) {
    written += bytes;
    if (pruning || written < PRUNE_AFTER_BYTES) {
      return;
    }
    written = 0;
    pruning = prune()
      .catch((error: unknown) =>
        process.emitWarning(`Thumbnail cache cleanup failed: ${String(error)}`),
      )
      .finally(() => {
        pruning = undefined;
      });
  }

  return {
    directory,
    async generate(source, key, signal, frame) {
      signal.throwIfAborted();
      // Created for each write, as resetting the cache deletes the folder.
      await mkdir(directory, { recursive: true });
      const temporary = path.join(directory, `${key}.${randomUUID()}.tmp`);
      try {
        const input = frame
          ? await frame(source.file, { height: THUMBNAIL_EDGE, width: THUMBNAIL_EDGE }, signal)
          : source.file;
        signal.throwIfAborted();
        const size = await renderThumbnail(input, temporary);
        const after = await stat(source.file);
        if (after.size !== source.info.size || after.mtimeMs !== source.info.mtimeMs) {
          throw new Error('Source changed during thumbnail generation; retry the request.');
        }
        await rename(temporary, fileOf(key));
        wrote(size);
      } finally {
        await rm(temporary, { force: true });
      }
    },
    async has(key) {
      try {
        const info = await stat(fileOf(key));
        if (Date.now() - info.mtimeMs > TOUCH_AFTER_MS) {
          const now = new Date();
          // Pruning may remove it meanwhile, which only means it is generated again.
          await utimes(fileOf(key), now, now).catch(() => null);
        }
        return true;
      } catch (error) {
        if (isMissing(error)) {
          return false;
        }
        throw error;
      }
    },
    prune,
  };
}
