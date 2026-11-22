import type { ReportedAttention } from '#photos/worker/on-screen/screen-contents';
import { DroppedError } from '#photos/worker/scheduler/dropped-error';
import { AHEAD_ROWS, LIMITS, nearestFirst } from '#photos/worker/scheduler/limits';
import type { Want } from '#photos/worker/scheduler/scheduler';
import type { KnownItem, ViewFile, ViewFileRange } from '@prism/catalog';
import { listedThumbnailKey, mediaKind } from '@prism/media';
import type { ThumbnailResult } from '@prism/shared';
import path from 'node:path';

// Thumbnails ahead of the scroll handed to the scheduler at a time, enough to keep its reads
// busy, so a new plan drops little.
const IN_FLIGHT = LIMITS.thumbnail.ahead * 2;

/** A thumbnail to make ahead of the scroll: its entry, and its key as the entry was listed. */
interface AheadThumbnail {
  id: string;
  key: string;
}

export interface AheadSources {
  root: string;
  attention: ReportedAttention;
  /**
   * Entries of an open view as the catalog listed them, with folders' covers: all of them if it
   * has fewer than `limit` rows, or else those from `start` up to `end`; `null` if it is closed.
   */
  viewFiles: (
    viewId: string,
    start: number,
    end: number,
    limit: number,
  ) => Promise<ViewFileRange | null>;
  /** Makes the thumbnail of `entryId`, named `key` as listed, unless cached, as `wants` says. */
  make: (entryId: string, key: string, wants: Want) => Promise<ThumbnailResult>;
  signal: AbortSignal;
}

/**
 * The file whose thumbnail the row `file` has made ahead: a folder's first cover, in any view,
 * or, in a view read `whole`, a photo's or video's own.
 */
function aheadFor(file: ViewFile | undefined, whole: boolean): KnownItem | undefined {
  if (file?.kind === 'directory') {
    return file.cover;
  }
  return whole ? file : undefined;
}

/**
 * Makes the thumbnails ahead of the scroll of the views the window shows, nearest to the rows on
 * show first, after the thumbnails the window shows: the covers of the folders within
 * `AHEAD_ROWS / 2` rows of those on show in every view, and, in a view smaller than `AHEAD_ROWS`,
 * those of all its rows. `make` leaves thumbnails already cached alone, as the main process serves
 * them without the worker. Each time what the window shows, or a view it shows, changes, it plans
 * again from the rows on show, and what it handed the scheduler for the last plan is dropped if
 * it has not started.
 */
export class ThumbnailsAhead {
  #plan = 0;
  /**
   * Thumbnails that could not be made, as of a video only the window can take a still of, which a
   * new plan does not try again.
   */
  readonly #failed = new Set<string>();
  /**
   * The files of each small view on show, read whole, again only once the view changes, not as
   * the window scrolls; a large view's near the scroll are read for each plan.
   */
  readonly #files = new Map<string, ViewFileRange>();

  constructor(private readonly sources: AheadSources) {}

  /** Plans again, from what the window shows now. */
  replan(): void {
    this.#plan += 1;
    this.#run(this.#plan).catch(() => null);
  }

  /** Plans again with the files of `viewId` as they are now, as it has a new version. */
  changed(viewId: string): void {
    this.#files.delete(viewId);
    this.replan();
  }

  /** Tries again the thumbnails that could not be made, as after a refresh. */
  forget(): void {
    this.#failed.clear();
    this.#files.clear();
    this.replan();
  }

  #current(plan: number) {
    return plan === this.#plan && !this.sources.signal.aborted;
  }

  async #run(plan: number) {
    const { attention, viewFiles } = this.sources;
    // Only the views on show are kept.
    for (const viewId of this.#files.keys()) {
      if (!attention.views.some((rows) => rows.viewId === viewId)) {
        this.#files.delete(viewId);
      }
    }
    for (const { viewId, start, end } of attention.views) {
      const read =
        this.#files.get(viewId) ??
        (await viewFiles(viewId, start - AHEAD_ROWS / 2, end + AHEAD_ROWS / 2, AHEAD_ROWS));
      if (!this.#current(plan)) {
        return;
      }
      if (read?.whole) {
        this.#files.set(viewId, read);
      }
      if (read) {
        const { files, whole } = read;
        const order = nearestFirst(files.length, start - read.start, end - read.start);
        await this.#makeAll(
          plan,
          order.flatMap((index) => this.#thumbnailOf(files[index], whole) ?? []),
        );
      }
    }
  }

  /**
   * The thumbnail made ahead for the row `file`, named from its listing (see `aheadFor`); `null`
   * for a file listed before the catalog kept what names its thumbnail, made once it is on show.
   */
  #thumbnailOf(file: ViewFile | undefined, whole: boolean): AheadThumbnail | null {
    const listed = aheadFor(file, whole);
    const kind = listed && mediaKind(listed.id);
    if (
      !listed ||
      !kind ||
      listed.inode === null ||
      listed.modifiedMs === null ||
      listed.size === null
    ) {
      return null;
    }
    const { id, inode, modifiedMs, size } = listed;
    const known = { file: path.join(this.sources.root, id), inode, modifiedMs, size };
    return { id, key: listedThumbnailKey(known, kind === 'video') };
  }

  /** Makes `thumbnails` in turn, a few at a time, while `plan` holds. */
  async #makeAll(plan: number, thumbnails: AheadThumbnail[]) {
    const making = new Set<Promise<void>>();
    for (const thumbnail of thumbnails) {
      if (!this.#current(plan)) {
        break;
      }
      if (this.#failed.has(thumbnail.key)) {
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

  /**
   * Makes one thumbnail, wanted while `plan` holds. One that fails, as a video only the window can
   * take a still of, is not tried again; one dropped for a new plan is.
   */
  async #make(plan: number, { id, key }: AheadThumbnail) {
    const wants: Want = () => (this.#current(plan) ? 'ahead' : null);
    const failed = await this.sources.make(id, key, wants).then(
      ({ status }) => status !== 'ready',
      (error: unknown) => !(error instanceof DroppedError),
    );
    if (failed) {
      this.#failed.add(key);
    }
  }
}
