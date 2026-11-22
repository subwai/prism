import { RequestQueue } from '#data/media/request-queue';
import { captureFrame, captureOpeningFrame } from '#data/media/video-frame';
import { about } from '#data/queries';
import type { PhotoEntry, PhotosAPI, ThumbnailResult, ThumbnailUpdate } from '@prism/shared';
import { type QueryClient, queryOptions } from '@tanstack/react-query';

const MAX_OPENING_FRAMES = 32;
// Thumbnails told of that no tile reads any more, kept so a tile scrolled back to shows its own at
// once: a fixed number, whatever the library's size, of about 1-2 MB. Each is a path and a URL.
const MAX_TOLD_THUMBNAILS = 10_000;

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
   * What the worker told of each thumbnail it made, or could not, while its entry was on show or
   * a tile read it, which a tile whose cached thumbnail was missing shows; see `ThumbnailUpdate`.
   * The oldest first, as a map lists its keys in the order they were set.
   */
  private readonly thumbnails = new Map<string, ThumbnailResult>();
  /** What reads the generation. */
  private readonly listeners = new Set<() => void>();
  /** What reads each entry's thumbnail news, by entry: the tiles and pages mounted. */
  private readonly readers = new Map<string, Set<() => void>>();

  /**
   * Originals are read for entries `wanted` on screen when their turn comes, so pages the reader
   * scrolls past quickly do not hold up the one it stops on. They decode here, a few at a time;
   * thumbnails are made by the worker, whose scheduler orders them by what the window shows,
   * and told of as they are.
   */
  constructor(
    private readonly api: PhotosAPI,
    private readonly queries: QueryClient,
    private readonly wanted: (entryId: string) => boolean,
  ) {
    this.originals = new RequestQueue(4, wanted);
  }

  /**
   * Calls `listener` as a refresh has cached thumbnails read again, see `cachedThumbnailURL`;
   * returns the unsubscribe function.
   */
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /**
   * Calls `listener` as what is known of the thumbnail of `entryId` changes; returns the
   * unsubscribe function. While it listens, what the worker tells of it is kept, on show or not:
   * a tile rendered just off screen whose cached thumbnail was missing hears of the one made ahead
   * of the scroll, which the worker does not tell again once the tile is on show, as it is cached.
   */
  subscribeThumbnail(entryId: string, listener: () => void) {
    const readers = this.readers.get(entryId) ?? new Set();
    readers.add(listener);
    this.readers.set(entryId, readers);
    return () => {
      readers.delete(listener);
      if (readers.size === 0) {
        this.readers.delete(entryId);
      }
    };
  }

  private changed(entryId: string) {
    for (const reader of this.readers.get(entryId) ?? []) {
      reader();
    }
  }

  getGeneration = () => this.generation;

  /**
   * What the worker last told of the thumbnail of `entryId`, if it has since it was on show or a
   * tile read it.
   */
  thumbnail(entryId: string): ThumbnailResult | undefined {
    return this.thumbnails.get(entryId);
  }

  /**
   * Takes what the worker tells of a thumbnail, taking the still of a video it cannot render once
   * it is on show. One nothing reads is left, as most made ahead of the scroll are: it was made,
   * and its cached thumbnail shows once a tile asks for it. Of those no tile reads any more, only
   * the latest `MAX_TOLD_THUMBNAILS` are kept, whatever the library's size.
   */
  async hear(news: ThumbnailUpdate) {
    const { entryId } = news;
    const wanted = this.wanted(entryId);
    if (news.status === 'frame-needed' ? !wanted : !wanted && !this.readers.has(entryId)) {
      return;
    }
    const told =
      news.status === 'frame-needed'
        ? await this.captureThumbnail(entryId).catch((error: unknown): ThumbnailResult => ({
            message: String(error),
            status: 'failed',
          }))
        : news;
    // Set anew, as the latest.
    this.thumbnails.delete(entryId);
    this.thumbnails.set(entryId, told);
    this.trimThumbnails();
    this.changed(entryId);
  }

  /** Forgets the oldest news no tile reads, past `MAX_TOLD_THUMBNAILS`. */
  private trimThumbnails() {
    for (const entryId of this.thumbnails.keys()) {
      if (this.thumbnails.size <= MAX_TOLD_THUMBNAILS) {
        break;
      }
      if (!this.readers.has(entryId)) {
        this.thumbnails.delete(entryId);
      }
    }
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
      this.changed(entryId);
    }
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
    for (const listener of this.listeners) {
      listener();
    }
    for (const entryId of this.readers.keys()) {
      this.changed(entryId);
    }
  }
}
