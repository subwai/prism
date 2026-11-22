import type { Scheduler } from '#photos/worker/scheduler/scheduler';
import { filesOwnFailures, type Share } from '#photos/worker/share/share';
import type { Catalog, PhotoFile, ReadDetails, UnreadableFile, UnreadPhoto } from '@prism/catalog';
import { inodeOf, readExif } from '@prism/media';
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
  /** Whether the library's folder can be reached, which says whose a failure to read is. */
  share: Share;
}

/**
 * Reads photos' details into the catalog, every photo once: from what the catalog kept of the
 * file before, as a row removed or another library holding it left them, or else from the file,
 * so filters and the sort by date taken cover the whole library: those on screen first, then the rest of the open view, then
 * the rest of the library. It reads gently until a view needs the details, and photos whose
 * files change are read again, as are those that could not be read. What it read, or could not,
 * survives in the catalog, so a later session carries on where it stopped.
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
      const photos = await catalog.call('photosToRead', BATCH).catch((): UnreadPhoto[] => []);
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

  /** Reads the details of `photos`: from the catalog where it kept them, or else their files. */
  private async read(photos: UnreadPhoto[]) {
    const { catalog, root, scheduler, share, signal } = this.sources;
    const failed: Failure[] = [];
    // A photo that fails is noted with its file as it was then. Closing drops what waits.
    const attempt = <Result>(
      step: string,
      photo: UnreadPhoto,
      file: UnreadableFile,
      task: () => Promise<Result>,
    ) =>
      scheduler.run('details', `${step} ${photo.id}`, this.wants, task).catch((error: unknown) => {
        if (!signal.aborted) {
          failed.push({ error, file, item: photo.item });
        }
      });
    const files = await Promise.all(
      photos.map((photo) => attempt('stat', photo, photo, () => stated(root, photo.id))),
    );
    const found = files.filter((file) => file !== undefined);
    const unrecalled = new Set(await catalog.call('reuseDetails', found).catch((): string[] => []));
    const details: ReadDetails[] = [];
    await Promise.all(
      photos.map((photo, index) => {
        const file = files[index];
        return file && unrecalled.has(file.id)
          ? attempt('exif', photo, file, async () =>
              details.push({ ...file, exif: await readExif(file.file) }),
            )
          : undefined;
      }),
    );
    if (details.length > 0) {
      catalog.write({ details, kind: 'storeDetails' });
    }
    // Those the catalog keeps as unreadable count as done until their files change; the rest,
    // as of a share gone offline, are skipped for the session and tried again in the next.
    const unreadable = new Set(await filesOwnFailures(share, failed));
    if (unreadable.size > 0) {
      catalog.write({ files: [...unreadable].map(({ file }) => file), kind: 'markUnreadable' });
    }
    const skipped = failed.filter((failure) => !unreadable.has(failure));
    if (skipped.length > 0) {
      await catalog
        .call(
          'skip',
          skipped.map(({ item }) => item),
        )
        .catch(() => null);
    }
  }
}

/** A photo whose details could not be read, with its file as it was then, and why. */
interface Failure {
  item: number;
  file: UnreadableFile;
  error: unknown;
}

/** The photo at `id` as it is on disk now. */
async function stated(root: string, id: string): Promise<PhotoFile> {
  const file = path.join(root, id);
  const info = await stat(file);
  return { file, id, inode: inodeOf(info), modifiedMs: info.mtimeMs, size: info.size };
}
