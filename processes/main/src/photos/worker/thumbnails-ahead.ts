import type { WindowAttention } from '#photos/worker/attention';
import { DroppedError } from '#photos/worker/dropped-error';
import type { Want } from '#photos/worker/scheduler';
import { makesAhead, nearestFirst } from '#photos/worker/scheduling';
import type { KnownItem } from '@prism/catalog';
import {
  hasThumbnail,
  listedThumbnailKey,
  mediaKind,
  THUMBNAIL_CONCURRENCY,
  type ThumbnailCache,
} from '@prism/media';
import path from 'node:path';

// Thumbnails ahead of the scroll handed to the scheduler at a time, enough to keep its decodes
// busy, so a new plan drops little.
const IN_FLIGHT = THUMBNAIL_CONCURRENCY * 2;

/** A thumbnail to make ahead of the scroll: its entry, and its key as the entry was listed. */
interface AheadThumbnail {
  id: string;
  key: string;
}

export interface AheadSources {
  root: string;
  attention: WindowAttention;
  cache: ThumbnailCache;
  /** Every entry of an open view as the catalog listed it; `null` if it is closed. */
  viewFiles: (viewId: string) => Promise<KnownItem[] | null>;
  /** Makes the thumbnail of `entryId`, named `key` as listed, as `wants` says. */
  make: (entryId: string, key: string, wants: Want) => Promise<unknown>;
  signal: AbortSignal;
}

/**
 * Makes the thumbnails of the views the window shows that are smaller than `AHEAD_ROWS`, all of
 * them, nearest to the rows on show first, after the thumbnails the window shows. Thumbnails
 * already cached are left alone, as the main process serves them without the worker. Each time
 * what the window shows, or a view it shows, changes, it plans again from the rows on show, and
 * what it handed the scheduler for the last plan is dropped if it has not started.
 */
export class ThumbnailsAhead {
  #plan = 0;
  /**
   * Thumbnails that could not be made, as of a video only the window can take a still of, which a
   * new plan does not try again.
   */
  readonly #failed = new Set<string>();

  constructor(private readonly sources: AheadSources) {}

  /** Plans again, from what the window shows now. */
  replan(): void {
    this.#plan += 1;
    this.#run(this.#plan).catch(() => null);
  }

  /** Tries again the thumbnails that could not be made, as after a refresh. */
  forget(): void {
    this.#failed.clear();
    this.replan();
  }

  #current(plan: number) {
    return plan === this.#plan && !this.sources.signal.aborted;
  }

  async #run(plan: number) {
    const { attention, viewFiles } = this.sources;
    for (const { viewId, start, end } of attention.views) {
      const files = await viewFiles(viewId);
      if (!this.#current(plan)) {
        return;
      }
      if (files && makesAhead(files.length)) {
        const order = nearestFirst(files.length, start, end);
        await this.#makeAll(
          plan,
          order.flatMap((index) => this.#thumbnailOf(files[index]) ?? []),
        );
      }
    }
  }

  /**
   * The thumbnail of `file`, named from its listing; `null` for a folder, or a file listed before
   * the catalog kept what names its thumbnail, which the window asks for once it is on show.
   */
  #thumbnailOf(file: KnownItem | undefined): AheadThumbnail | null {
    const kind = file && mediaKind(file.id);
    if (!file || !kind || file.inode === null || file.modifiedMs === null || file.size === null) {
      return null;
    }
    const { id, inode, modifiedMs, size } = file;
    const listed = { file: path.join(this.sources.root, id), inode, modifiedMs, size };
    return { id, key: listedThumbnailKey(listed, kind === 'video') };
  }

  /** Makes `thumbnails` in turn, those not cached, a few at a time, while `plan` holds. */
  async #makeAll(plan: number, thumbnails: AheadThumbnail[]) {
    const making = new Set<Promise<void>>();
    for (const thumbnail of thumbnails) {
      if (!this.#current(plan)) {
        break;
      }
      if (this.#failed.has(thumbnail.key) || (await this.#cached(thumbnail.key))) {
        continue;
      }
      if (making.size >= IN_FLIGHT) {
        await Promise.race(making);
      }
      const job = this.#make(plan, thumbnail).finally(() => making.delete(job));
      making.add(job);
    }
    await Promise.all(making);
  }

  #cached(key: string) {
    return hasThumbnail(this.sources.cache, key).catch(() => false);
  }

  /**
   * Makes one thumbnail, wanted while `plan` holds. One that fails, as a video only the window can
   * take a still of, is not tried again; one dropped for a new plan is.
   */
  async #make(plan: number, { id, key }: AheadThumbnail) {
    const wants: Want = () => (this.#current(plan) ? 'ahead' : null);
    try {
      await this.sources.make(id, key, wants);
    } catch (error) {
      if (!(error instanceof DroppedError)) {
        this.#failed.add(key);
      }
    }
  }
}
