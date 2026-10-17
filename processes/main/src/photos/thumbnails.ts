import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, rename, rm, stat, utimes } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const MAX_INPUT_PIXELS = 100_000_000,
  QUALITY = 75,
  THUMBNAIL_EDGE = 384,
  CACHE_BUDGET_BYTES = 512 * 1024 * 1024,
  SWEEP_INTERVAL_MS = 60_000;

/** Renders a still of a video as an encoded image, `edge` pixels at most on its longer side. */
export type FrameReader = (
  source: string,
  edge: number,
  signal: AbortSignal
) => Promise<Uint8Array>;

export class ThumbnailCache {
  private lastSweep = 0;
  private sweeping?: Promise<void>;

  constructor(
    readonly directory: string,
    private readonly budget = CACHE_BUDGET_BYTES
  ) {
    // Image-level parallelism is bounded separately by the work queue.
    sharp.concurrency(1);
    sharp.cache({ files: 0, items: 64, memory: 32 });
  }

  /** Thumbnails `source`, or for a video the still that `frame` reads from it. */
  async generate(source: string, signal: AbortSignal, frame?: FrameReader): Promise<string> {
    signal.throwIfAborted();
    const before = await stat(source, { bigint: true });
    if (!before.isFile()) {
      throw new Error('Thumbnail source is not a file.');
    }
    const key = createHash('sha256')
      .update(
        JSON.stringify([
          source,
          String(before.size),
          String(before.mtimeNs),
          THUMBNAIL_EDGE,
          QUALITY,
          frame ? 'webp-video-frame-v3' : 'webp-auto-orient-v1'
        ])
      )
      .digest('hex');
    await mkdir(this.directory, { recursive: true });
    const destination = path.join(this.directory, `${key}.webp`);
    try {
      await stat(destination);
      const now = new Date();
      await utimes(destination, now, now);
      this.scheduleSweep();
      return key;
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) {
        throw error;
      }
    }
    signal.throwIfAborted();
    const temporary = path.join(this.directory, `${key}.${randomUUID()}.tmp`);
    try {
      const input = frame ? await frame(source, THUMBNAIL_EDGE, signal) : source;
      signal.throwIfAborted();
      await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, sequentialRead: true })
        .autoOrient()
        .resize({
          fit: 'inside',
          height: THUMBNAIL_EDGE,
          width: THUMBNAIL_EDGE,
          withoutEnlargement: true
        })
        .webp({ quality: QUALITY })
        .toFile(temporary);
      const after = await stat(source, { bigint: true });
      if (before.size !== after.size || before.mtimeNs !== after.mtimeNs) {
        throw new Error('Source changed during thumbnail generation; retry the request.');
      }
      await rename(temporary, destination);
      this.scheduleSweep();
      return key;
    } finally {
      await rm(temporary, { force: true });
    }
  }

  private scheduleSweep(): void {
    if (!this.sweeping && Date.now() - this.lastSweep >= SWEEP_INTERVAL_MS) {
      this.lastSweep = Date.now();
      this.sweeping = this.prune()
        .catch((error: unknown) =>
          process.emitWarning(`Thumbnail cache cleanup failed: ${String(error)}`)
        )
        .finally(() => {
          this.sweeping = undefined;
        });
    }
  }

  async prune(): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const files: { file: string; size: number; modified: number }[] = [];
    // One stat at a time keeps cache maintenance from flooding the filesystem pool.
    for (const name of await readdir(this.directory)) {
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
        if (info && Date.now() - info.mtimeMs > SWEEP_INTERVAL_MS) {
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
