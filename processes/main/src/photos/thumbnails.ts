import { isMissing } from '#photos/validate';
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

/** Renders a still of a video as an encoded image, `edge` pixels at most on its longer side. */
export type FrameReader = (
  source: string,
  edge: number,
  signal: AbortSignal,
) => Promise<Uint8Array>;

/** A photo or video as it was when its thumbnail was asked for. */
export interface ThumbnailSource {
  file: string;
  info: Stats;
}

/**
 * Raise the version of `THUMBNAIL_DIRECTORY_NAME` whenever this changes, or `PIPELINE` does.
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

export class ThumbnailCache {
  // The first write prunes, catching up with what earlier sessions wrote.
  private written = PRUNE_AFTER_BYTES;
  private pruning?: Promise<void>;

  constructor(
    readonly directory: string,
    private readonly budget = CACHE_BUDGET_BYTES,
  ) {
    // Image-level parallelism is bounded separately by the work queue.
    sharp.concurrency(1);
    sharp.cache({ files: 0, items: 64, memory: 32 });
  }

  private file(key: string) {
    return path.join(this.directory, `${key}.webp`);
  }

  /** Whether thumbnail `key` is cached; marks it as used. */
  async has(key: string): Promise<boolean> {
    try {
      const info = await stat(this.file(key));
      if (Date.now() - info.mtimeMs > TOUCH_AFTER_MS) {
        const now = new Date();
        // Pruning may remove it meanwhile, which only means it is generated again.
        await utimes(this.file(key), now, now).catch(() => null);
      }
      return true;
    } catch (error) {
      if (isMissing(error)) {
        return false;
      }
      throw error;
    }
  }

  /** Renders thumbnail `key` of `source`, or of the still that `frame` reads from it. */
  async generate(
    source: ThumbnailSource,
    key: string,
    signal: AbortSignal,
    frame?: FrameReader,
  ): Promise<void> {
    signal.throwIfAborted();
    // Created for each write, as resetting the cache deletes the folder.
    await mkdir(this.directory, { recursive: true });
    const temporary = path.join(this.directory, `${key}.${randomUUID()}.tmp`);
    try {
      const input = frame ? await frame(source.file, THUMBNAIL_EDGE, signal) : source.file;
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
      await rename(temporary, this.file(key));
      this.wrote(size);
    } finally {
      await rm(temporary, { force: true });
    }
  }

  private wrote(bytes: number): void {
    this.written += bytes;
    if (this.pruning || this.written < PRUNE_AFTER_BYTES) {
      return;
    }
    this.written = 0;
    this.pruning = this.prune()
      .catch((error: unknown) =>
        process.emitWarning(`Thumbnail cache cleanup failed: ${String(error)}`),
      )
      .finally(() => {
        this.pruning = undefined;
      });
  }

  async prune(): Promise<void> {
    const files: { file: string; size: number; modified: number }[] = [];
    // One stat at a time keeps cache maintenance from flooding the filesystem pool.
    for (const name of await readdir(this.directory).catch(() => [])) {
      const file = path.join(this.directory, name);
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
      if (bytes <= this.budget) {
        break;
      }
      await rm(file.file, { force: true });
      bytes -= file.size;
    }
  }
}
