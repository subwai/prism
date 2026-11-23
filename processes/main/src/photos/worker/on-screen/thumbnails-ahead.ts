import { AHEAD_ROWS, nearestFirst } from '#photos/worker/on-screen/nearest-first';
import type { LatestScreenContents } from '#photos/worker/on-screen/screen-contents';
import { LIMITS } from '#photos/worker/scheduler/limits';
import { NoLongerWantedError } from '#photos/worker/scheduler/no-longer-wanted-error';
import type { CurrentPriority } from '#photos/worker/scheduler/scheduler';
import type { KnownItem, ViewFile, ViewFileRange } from '@prism/catalog';
import { listedThumbnailKey, mediaKind } from '@prism/media';
import { runAFewAtATime, type ThumbnailResult } from '@prism/shared';
import { LRUCache } from 'lru-cache';
import path from 'node:path';

// Thumbnails ahead of the scroll handed to the scheduler at a time, enough to keep its reads
// busy, so a new plan drops little.
const IN_FLIGHT = LIMITS.thumbnail.ahead * 2;
// Thumbnails that could not be made, remembered so a new plan skips them: ten times the rows a
// plan looks ahead over (`AHEAD_ROWS`), so going back and forth over a few views tries none
// again. At about 150 bytes a key, that is at most 1.5 MB, whatever the library's size. One
// forgotten is only tried once more.
const MAX_FAILED = 10 * AHEAD_ROWS;

/** A thumbnail to make ahead of the scroll: its entry, and its key as the entry was listed. */
interface AheadThumbnail {
  id: string;
  key: string;
}

export interface AheadSources {
  root: string;
  screen: LatestScreenContents;
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
  /** Makes the thumbnail of `entryId`, named `key` as listed, at `priority`, unless it is cached. */
  makeThumbnail: (
    entryId: string,
    key: string,
    priority: CurrentPriority,
  ) => Promise<ThumbnailResult>;
  signal: AbortSignal;
}

/**
 * The file whose thumbnail is made ahead for the row `file`: a folder's first cover in any view,
 * and a photo's or video's own only in a view read `whole`.
 */
function fileToMakeAhead(file: ViewFile | undefined, whole: boolean): KnownItem | undefined {
  if (file?.kind === 'directory') {
    return file.cover;
  }
  return whole ? file : undefined;
}

/**
 * Makes the thumbnails ahead of the scroll in the views the window shows, after the thumbnails
 * on screen, nearest to the rows on screen first. They are:
 * - in every view, the covers of the folders within `AHEAD_ROWS / 2` rows of the screen;
 * - in a view smaller than `AHEAD_ROWS`, the thumbnails of all its rows.
 * `makeThumbnail` leaves thumbnails already cached alone, because the main process serves those
 * without the worker. Whenever what the window shows changes, or a view it shows does, this plans
 * again from the rows on screen. What it handed the scheduler for the last plan is dropped if it
 * has not started.
 */
export class ThumbnailsAhead {
  #plan = 0;
  /**
   * Thumbnails that could not be made, such as of a video only the window can take a still of.
   * A new plan does not try them again. The oldest are forgotten past `MAX_FAILED`.
   */
  readonly #failed = new LRUCache<string, true>({ max: MAX_FAILED });
  /**
   * The files of each small view on screen, read whole. They are read again only when the view
   * changes, not as the window scrolls. A large view's files near the scroll are read for each
   * plan instead.
   */
  readonly #files = new Map<string, ViewFileRange>();

  constructor(private readonly sources: AheadSources) {}

  /** Plans again, from what the window shows now. */
  plan(): void {
    this.#plan += 1;
    this.#runPlan(this.#plan).catch(() => null);
  }

  /** Plans again with the files of `viewId` as they are now, because it has a new version. */
  viewChanged(viewId: string): void {
    this.#files.delete(viewId);
    this.plan();
  }

  /** Tries again the thumbnails that could not be made, as after a refresh. */
  startOver(): void {
    this.#failed.clear();
    this.#files.clear();
    this.plan();
  }

  #isCurrent(plan: number) {
    return plan === this.#plan && !this.sources.signal.aborted;
  }

  async #runPlan(plan: number) {
    const { screen, viewFiles } = this.sources;
    // Only the files of views on screen are kept.
    for (const viewId of this.#files.keys()) {
      if (!screen.views.some((rows) => rows.viewId === viewId)) {
        this.#files.delete(viewId);
      }
    }
    for (const { viewId, start, end } of screen.views) {
      const read =
        this.#files.get(viewId) ??
        (await viewFiles(viewId, start - AHEAD_ROWS / 2, end + AHEAD_ROWS / 2, AHEAD_ROWS));
      if (!this.#isCurrent(plan)) {
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
          order.flatMap((index) => this.#thumbnailToMake(files[index], whole) ?? []),
        );
      }
    }
  }

  /**
   * The thumbnail to make ahead for the row `file`, with its key named from what the catalog
   * has (see `fileToMakeAhead`). `null` for a file listed before the catalog kept what names
   * its thumbnail: that one is made once it is on screen.
   */
  #thumbnailToMake(file: ViewFile | undefined, whole: boolean): AheadThumbnail | null {
    const listed = fileToMakeAhead(file, whole);
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

  /** Makes `thumbnails` in order, a few at a time, while `plan` is still the current plan. */
  async #makeAll(plan: number, thumbnails: AheadThumbnail[]) {
    let next = 0;
    await runAFewAtATime({
      limit: IN_FLIGHT,
      run: (thumbnail) => this.#makeOne(plan, thumbnail),
      takeNext: () => {
        while (next < thumbnails.length && this.#isCurrent(plan)) {
          const thumbnail = thumbnails[next];
          next += 1;
          if (thumbnail && !this.#failed.has(thumbnail.key)) {
            return thumbnail;
          }
        }
        return null;
      },
    });
  }

  /**
   * Makes one thumbnail, wanted while `plan` is the current plan. One that fails, such as a video
   * only the window can take a still of, is not tried again. One dropped for a new plan is.
   */
  async #makeOne(plan: number, { id, key }: AheadThumbnail) {
    const priority: CurrentPriority = () => (this.#isCurrent(plan) ? 'ahead' : null);
    const failed = await this.sources.makeThumbnail(id, key, priority).then(
      ({ status }) => status !== 'ready',
      (error: unknown) => !(error instanceof NoLongerWantedError),
    );
    if (failed) {
      this.#failed.set(key, true);
    }
  }
}
