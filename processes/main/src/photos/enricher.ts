import { identityOf, type PhotoFile, type ReadDetails } from '#photos/catalog/cached-details';
import type { Catalog } from '#photos/catalog/client';
import type { UnreadPhoto } from '#photos/catalog/data/details';
import { readExif } from '#photos/exif';
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
 * Reads photos' details into the catalog, every photo once: from the cache of what was read
 * before, in this library or another that holds the same files, or else from the file. Then
 * filters and the sort by date taken cover the whole library: those on screen first, then the
 * rest of the open view, then the rest of the library. It reads gently until a view needs the
 * details, and photos whose files change are read again. What it read survives in the
 * catalog, so a later session carries on where it stopped.
 */
export interface Enricher {
  /** Starts reading, once. */
  start: () => void;
  /** More photos may want reading, as a read or a change added some. */
  nudge: () => void;
  /** Whether a view needs photos' details now, which reads them at full speed. */
  want: (urgent: boolean) => void;
}

export function createEnricher({ busy, catalog, root, signal }: EnricherSources): Enricher {
  const state = { started: false, urgent: false };
  let woken = Promise.withResolvers<null>();

  /** Runs `task` once background reads may, which make way for thumbnails unless urgent. */
  async function gently<Result>(task: () => Promise<Result>): Promise<Result | undefined> {
    while (!state.urgent && busy() && !signal.aborted) {
      await wait(YIELD_MS, signal);
    }
    return signal.aborted ? undefined : task();
  }

  /** Reads the details of `photos`: from the cache where it has them, or else their files. */
  async function read(photos: UnreadPhoto[]) {
    const limit = pLimit(state.urgent ? WANTED_READS : BACKGROUND_READS);
    const unreadable: number[] = [];
    // Gone, or unreadable for now: the next session tries again.
    const attempt = <Result>(photo: UnreadPhoto, task: () => Promise<Result>) =>
      limit(() => gently(task)).catch(() => {
        unreadable.push(photo.item);
      });
    const files = await Promise.all(
      photos.map((photo) => attempt(photo, () => stated(root, photo.id))),
    );
    const found = files.filter((file) => file !== undefined);
    const uncached = new Set(await catalog.call('recall', found).catch((): string[] => []));
    const details: ReadDetails[] = [];
    await Promise.all(
      photos.map((photo, index) => {
        const file = files[index];
        return file && uncached.has(file.id)
          ? attempt(photo, async () => details.push({ ...file, exif: await readExif(file.file) }))
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

  async function run() {
    while (!signal.aborted) {
      woken = Promise.withResolvers();
      const photos = await catalog.call('wanted', BATCH).catch((): UnreadPhoto[] => []);
      if (photos.length === 0) {
        const aborted = new Promise((resolve) => {
          signal.addEventListener('abort', resolve, { once: true });
        });
        await Promise.race([woken.promise, aborted]);
      } else {
        await read(photos);
      }
    }
  }

  const nudge = () => woken.resolve(null);
  return {
    nudge,
    start() {
      if (state.started) {
        return;
      }
      state.started = true;
      run().catch(() => null);
    },
    want(wanted) {
      state.urgent = wanted;
      nudge();
    },
  };
}

/** The photo at `id` as it is on disk now. */
async function stated(root: string, id: string): Promise<PhotoFile> {
  const file = path.join(root, id);
  const info = await stat(file);
  return { file, id, identity: identityOf(info), modifiedMs: info.mtimeMs, size: info.size };
}
