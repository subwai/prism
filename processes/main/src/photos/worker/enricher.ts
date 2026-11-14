import type { Scheduler } from '#photos/worker/scheduler';
import {
  type Catalog,
  identityOf,
  type PhotoFile,
  type ReadDetails,
  type UnreadPhoto,
} from '@prism/catalog';
import { readExif } from '@prism/media';
import { stat } from 'node:fs/promises';
import path from 'node:path';

// Photos asked for at a time; the catalog picks the most wanted first.
const BATCH = 64;

export interface EnricherSources {
  root: string;
  catalog: Catalog;
  signal: AbortSignal;
  /**
   * Orders every read of the disk: photos' details are read in the background, making way for
   * the thumbnails and originals the window wants, and ahead of the scroll while a view needs them.
   */
  scheduler: Scheduler;
}

/**
 * Reads photos' details into the catalog, every photo once: from the cache of what was read
 * before, in this library or another that holds the same files, or else from the file, so filters and the sort by date
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
    // Closing wakes an idle run, so it sees the abort and stops.
    this.sources.signal.addEventListener('abort', () => this.nudge(), { once: true });
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
      await (photos.length === 0 ? this.woken.promise : this.read(photos));
    }
  }

  /** How much the details are wanted now: at once while a view needs them, or else gently. */
  private readonly wants = () => {
    if (this.sources.signal.aborted) {
      return null;
    }
    return this.urgent ? 'ahead' : 'background';
  };

  /** Reads the details of `photos`: from the cache where it has them, or else their files. */
  private async read(photos: UnreadPhoto[]) {
    const { catalog, scheduler, signal } = this.sources;
    const unreadable: number[] = [];
    // Gone, or unreadable for now: the next session tries again. Closing drops what waits.
    const attempt = <Result>(step: string, photo: UnreadPhoto, task: () => Promise<Result>) =>
      scheduler.run('details', `${step} ${photo.id}`, this.wants, task).catch(() => {
        if (!signal.aborted) {
          unreadable.push(photo.item);
        }
      });
    const files = await Promise.all(
      photos.map((photo) => attempt('stat', photo, () => stated(this.sources.root, photo.id))),
    );
    const found = files.filter((file) => file !== undefined);
    const uncached = new Set(await catalog.call('recall', found).catch((): string[] => []));
    const details: ReadDetails[] = [];
    await Promise.all(
      photos.map((photo, index) => {
        const file = files[index];
        return file && uncached.has(file.id)
          ? attempt('exif', photo, async () =>
              details.push({ ...file, exif: await readExif(file.file) }),
            )
          : undefined;
      }),
    );
    if (details.length > 0) {
      catalog.write({ details });
    }
    if (unreadable.length > 0) {
      await catalog.call('markUnreadable', unreadable).catch(() => null);
    }
  }
}

/** The photo at `id` as it is on disk now. */
async function stated(root: string, id: string): Promise<PhotoFile> {
  const file = path.join(root, id);
  const info = await stat(file);
  return { file, id, identity: identityOf(info), modifiedMs: info.mtimeMs, size: info.size };
}
