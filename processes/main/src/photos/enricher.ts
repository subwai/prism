import type { Catalog } from '#photos/catalog';
import type { PhotoDetails, UnreadPhoto } from '#photos/catalog-store';
import type { ExifDetails } from '#photos/exif';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import pLimit from 'p-limit';

// Photos read at once in the background, leaving the disk, or the network share, to what the
// window shows; and at once while a view needs their details, as a sort by date taken does.
const BACKGROUND_READS = 4,
  WANTED_READS = 16,
  // How long a background read waits for thumbnails to make way before looking again.
  YIELD_MS = 100,
  // Photos asked for at a time; the catalog picks the most wanted first.
  BATCH = 64;

export interface EnricherSources {
  root: string;
  catalog: Catalog;
  exif: ExifDetails;
  signal: AbortSignal;
  /** Whether thumbnails or originals are being made, which background reads make way for. */
  busy: () => boolean;
}

function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

/**
 * Reads photos' details into the catalog, every photo once, so filters and the sort by date
 * taken cover the whole library: those on screen first, then the rest of the open view, then
 * the rest of the library. It reads gently until a view needs the details, and photos whose
 * files change are read again. What it read survives in the catalog, so a later session
 * carries on where it stopped.
 */
export class Enricher {
  private urgent = false;
  private woken = Promise.withResolvers<null>();
  private started = false;

  constructor(private readonly sources: EnricherSources) {}

  /** Starts reading, once. */
  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    this.run().catch(() => null);
  }

  /** More photos may want reading, as a read or a change added some. */
  nudge(): void {
    this.woken.resolve(null);
  }

  /** Whether a view needs photos' details now, which reads them at full speed. */
  want(urgent: boolean): void {
    this.urgent = urgent;
    this.nudge();
  }

  private async run() {
    const { catalog, signal } = this.sources;
    while (!signal.aborted) {
      this.woken = Promise.withResolvers();
      const photos = await catalog.call('wanted', BATCH).catch((): UnreadPhoto[] => []);
      if (photos.length === 0) {
        const aborted = new Promise((resolve) => {
          signal.addEventListener('abort', resolve, { once: true });
        });
        await Promise.race([this.woken.promise, aborted]);
      } else {
        await this.read(photos);
      }
    }
  }

  private async read(photos: UnreadPhoto[]) {
    const { busy, catalog, exif, root, signal } = this.sources;
    const limit = pLimit(this.urgent ? WANTED_READS : BACKGROUND_READS);
    const details: PhotoDetails[] = [];
    const unreadable: number[] = [];
    await Promise.all(
      photos.map((photo) =>
        limit(async () => {
          while (!this.urgent && busy() && !signal.aborted) {
            await wait(YIELD_MS, signal);
          }
          if (signal.aborted) {
            return;
          }
          const file = path.join(root, photo.id);
          try {
            const info = await stat(file);
            details.push({
              exif: await exif.of(file, info, signal),
              id: photo.id,
              modifiedMs: info.mtimeMs,
              size: info.size,
            });
          } catch {
            // Gone, or unreadable for now: the next session tries again.
            unreadable.push(photo.item);
          }
        }),
      ),
    );
    if (details.length > 0) {
      catalog.write({ details });
    }
    if (unreadable.length > 0) {
      await catalog.call('markUnreadable', unreadable).catch(() => null);
    }
  }
}
