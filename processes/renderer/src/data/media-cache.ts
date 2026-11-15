import { about } from '#data/queries';
import { RequestQueue } from '#data/request-queue';
import { captureFrame, captureOpeningFrame } from '#data/video-frame';
import type { PhotoEntry, PhotosAPI, ThumbnailNews, ThumbnailResult } from '@prism/shared';
import { type QueryClient, queryOptions } from '@tanstack/react-query';

const MAX_OPENING_FRAMES = 32;

function originalKey(entryId: string) {
  return ['original', entryId] as const;
}

/** Resolves once `url` has decoded as an image. */
async function decode(url: string) {
  const image = new Image();
  image.src = url;
  await image.decode();
}

/** Thumbnails and originals: what the session has read of each photo's and video's contents. */
export class MediaCache {
  private readonly originals: RequestQueue;
  /** How often each entry's contents changed on disk, so its original's URL changes too. */
  private readonly revisions = new Map<string, number>();
  /** Object URLs of the frames videos start on, oldest first. */
  private readonly openingFrames = new Map<string, string>();
  /** Raised by each refresh, so cached thumbnails' URLs change and they are read again. */
  private generation = 0;
  /**
   * What the worker told of each thumbnail it found or made for an entry on show, which a tile
   * whose cached thumbnail was missing shows; see `ThumbnailNews`.
   */
  private readonly thumbnails = new Map<string, ThumbnailResult>();
  private readonly listeners = new Set<() => void>();

  /**
   * Originals are read for entries `wanted` on screen when their turn comes, so pages the reader
   * scrolls past quickly do not hold up the one it stops on. They decode here, a few at a time;
   * thumbnails are made by the worker, whose scheduler orders them by what the window shows,
   * and told of as they are.
   */
  constructor(
    private readonly api: PhotosAPI,
    private readonly queries: QueryClient,
    wanted: (entryId: string) => boolean,
  ) {
    this.originals = new RequestQueue(4, wanted);
  }

  /**
   * Calls `listener` as a refresh has cached thumbnails read again, see `cachedThumbnailURL`, or
   * the worker tells of a thumbnail; returns the unsubscribe function.
   */
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private changed() {
    for (const listener of this.listeners) {
      listener();
    }
  }

  getGeneration = () => this.generation;

  /** What the worker last told of the thumbnail of `entryId`, if it has since it was on show. */
  thumbnail(entryId: string): ThumbnailResult | undefined {
    return this.thumbnails.get(entryId);
  }

  /** Takes what the worker tells of a thumbnail, taking the still of a video it cannot render. */
  async hear(news: ThumbnailNews) {
    const { entryId } = news;
    const told =
      news.status === 'frame-needed'
        ? await this.captureThumbnail(entryId).catch((error: unknown): ThumbnailResult => ({
            message: String(error),
            status: 'failed',
          }))
        : news;
    this.thumbnails.set(entryId, told);
    this.changed();
  }

  /** Lets originals waiting for `entryId` go ahead, now that it is wanted again. */
  wake(entryId: string) {
    this.originals.wake(entryId);
  }

  /** A still taken here, for a video the system's thumbnailer cannot read, cached for good. */
  private async captureThumbnail(entryId: string): Promise<ThumbnailResult> {
    const image = await captureFrame(await this.originalURL(entryId));
    return this.api.storeThumbnail({ entryId, image });
  }

  /** The query only defeats the browser's cache of the file as it was before a change. */
  private async originalURL(entryId: string) {
    const revision = this.revisions.get(entryId) ?? 0;
    return `${await this.api.getOriginalURL(entryId)}${revision ? `?v=${revision}` : ''}`;
  }

  /**
   * The original's URL, `null` if it is unavailable. Settles once a photo has decoded, or a
   * video's opening frame has, so a viewer suspended on it can keep the previous one on screen
   * until then.
   */
  originalQuery(entry: PhotoEntry) {
    return queryOptions({
      queryFn: ({ signal }) =>
        this.originals.run(
          entry.id,
          async () => {
            try {
              const url = await this.originalURL(entry.id);
              await (entry.kind === 'video' ? this.captureOpening(entry.id, url) : decode(url));
              return url;
            } catch {
              return null;
            }
          },
          signal,
        ),
      queryKey: originalKey(entry.id),
    });
  }

  /** A video that cannot be read here still plays, or fails, in the viewer, which says so. */
  private async captureOpening(entryId: string, url: string) {
    const frame = await captureOpeningFrame(url).catch(() => null);
    if (frame) {
      const frameURL = URL.createObjectURL(frame);
      // Decoded before the viewer switches, as a photo is, so the new video's poster paints in
      // its first frame instead of leaving the viewer empty for one.
      await decode(frameURL).catch(() => null);
      this.dropOpeningFrame(entryId);
      this.openingFrames.set(entryId, frameURL);
      // A few dozen are plenty for browsing back and forth.
      const [oldest] = this.openingFrames.keys();
      if (oldest !== undefined && this.openingFrames.size > MAX_OPENING_FRAMES) {
        this.dropOpeningFrame(oldest);
      }
    }
  }

  private dropOpeningFrame(entryId: string) {
    const url = this.openingFrames.get(entryId);
    if (url) {
      URL.revokeObjectURL(url);
      this.openingFrames.delete(entryId);
    }
  }

  /** The frame a video starts on, once its original has loaded, to show until it plays. */
  peekOpeningFrame(entryId: string) {
    return this.openingFrames.get(entryId);
  }

  /** Reads entries whose contents changed again, showing the old ones until then. */
  forget(entryIds: string[]) {
    if (entryIds.length === 0) {
      return;
    }
    for (const entryId of entryIds) {
      this.revisions.set(entryId, (this.revisions.get(entryId) ?? 0) + 1);
      this.dropOpeningFrame(entryId);
      // The worker tells of the new one, as the entry is still on show.
      this.thumbnails.delete(entryId);
    }
    this.changed();
    const ids = new Set(entryIds);
    this.queries
      .invalidateQueries({ predicate: ({ queryKey }) => about(queryKey, ['original'], ids) })
      .catch(() => null);
  }

  clear() {
    for (const url of this.openingFrames.values()) {
      URL.revokeObjectURL(url);
    }
    this.openingFrames.clear();
    // Told again from nothing, rather than shown as they were meanwhile: after a reset, the last
    // news names a file that is gone, and an image of it stays broken once it fails to load.
    this.thumbnails.clear();
    this.generation += 1;
    this.changed();
  }
}
