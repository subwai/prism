import { decodeImage } from '#data/media/decode-image';
import { RequestQueue } from '#data/media/request-queue';
import { captureFrame, captureOpeningFrame } from '#data/media/video-frame';
import { isQueryAbout } from '#data/queries';
import type { PhotoEntry, PhotosAPI, ThumbnailResult, ThumbnailUpdate } from '@prism/shared';
import { type QueryClient, queryOptions } from '@tanstack/react-query';

const MAX_OPENING_FRAMES = 32;
// Thumbnail results that no tile reads any more are kept, so a tile scrolled back to shows its
// thumbnail at once. This many at most, whatever the library's size: about 1-2 MB, as each is a
// path and a URL.
const MAX_KEPT_RESULTS = 10_000;

function originalKey(entryId: string) {
  return ['original', entryId] as const;
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
   * The worker's result for each thumbnail it made, or failed to make, while its entry was on
   * screen or a tile read it. A tile whose cached thumbnail is missing shows this instead; see
   * `ThumbnailUpdate`. Oldest first, since a map keeps its keys in the order they were set.
   */
  private readonly results = new Map<string, ThumbnailResult>();
  /** What reads the generation. */
  private readonly listeners = new Set<() => void>();
  /** The listeners for each entry's thumbnail result: the tiles and pages mounted. */
  private readonly readers = new Map<string, Set<() => void>>();

  /**
   * Originals are read only for entries still on screen when their turn comes, so pages the
   * reader scrolls past quickly do not hold up the one it stops on. They decode here, a few at a
   * time. Thumbnails are made by the worker, whose scheduler orders them by what is on screen,
   * and sent here as each is made.
   */
  constructor(
    private readonly api: PhotosAPI,
    private readonly queries: QueryClient,
    private readonly isOnScreen: (entryId: string) => boolean,
  ) {
    this.originals = new RequestQueue(4, isOnScreen);
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
   * Calls `listener` when the thumbnail result for `entryId` changes, and returns the unsubscribe
   * function. While anything listens, results for the entry are kept even when it is off screen.
   * That matters for a tile rendered just off screen whose cached thumbnail was missing: the
   * worker sends the thumbnail it makes ahead of the scroll only once, and not again when the
   * tile comes on screen, because by then it is cached.
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

  private notifyReaders(entryId: string) {
    for (const reader of this.readers.get(entryId) ?? []) {
      reader();
    }
  }

  getGeneration = () => this.generation;

  /**
   * The worker's last result for the thumbnail of `entryId`, if it sent one since the entry was
   * on screen or a tile read it.
   */
  thumbnailResult(entryId: string): ThumbnailResult | undefined {
    return this.results.get(entryId);
  }

  /**
   * Takes a thumbnail update from the worker. For a video the system cannot thumbnail, it takes
   * a still here, once the video is on screen.
   *
   * An update nothing reads is dropped, as most made ahead of the scroll are: the thumbnail was
   * made, and its cached copy shows once a tile asks for it. Of the results no tile reads any
   * more, only the latest `MAX_KEPT_RESULTS` are kept, whatever the library's size.
   */
  async receiveThumbnail(update: ThumbnailUpdate) {
    const { entryId } = update;
    const onScreen = this.isOnScreen(entryId);
    if (update.status === 'frame-needed' ? !onScreen : !onScreen && !this.readers.has(entryId)) {
      return;
    }
    const result =
      update.status === 'frame-needed'
        ? await this.captureThumbnail(entryId).catch((error: unknown): ThumbnailResult => ({
            message: String(error),
            status: 'failed',
          }))
        : update;
    // Deleted and set again, so it moves to the end as the newest.
    this.results.delete(entryId);
    this.results.set(entryId, result);
    this.trimResults();
    this.notifyReaders(entryId);
  }

  /** Drops the oldest results that no tile reads, past `MAX_KEPT_RESULTS`. */
  private trimResults() {
    for (const entryId of this.results.keys()) {
      if (this.results.size <= MAX_KEPT_RESULTS) {
        break;
      }
      if (!this.readers.has(entryId)) {
        this.results.delete(entryId);
      }
    }
  }

  /** Lets originals waiting for `entryId` go ahead, now that it is on screen again. */
  wake(entryId: string) {
    this.originals.wake(entryId);
  }

  /** A still taken here, for a video the system's thumbnailer cannot read, cached for good. */
  private async captureThumbnail(entryId: string): Promise<ThumbnailResult> {
    const image = await captureFrame(await this.originalURL(entryId));
    return this.api.storeThumbnail({ entryId, image });
  }

  /** The `?v=` part only stops the browser showing its cached copy from before a change. */
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
              await (entry.kind === 'video'
                ? this.captureOpening(entry.id, url)
                : decodeImage(url));
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
      await decodeImage(frameURL).catch(() => null);
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

  /**
   * Forgets what was read of entries whose files changed, so they are read again. The old ones
   * show until then.
   */
  forgetContents(entryIds: string[]) {
    if (entryIds.length === 0) {
      return;
    }
    for (const entryId of entryIds) {
      this.revisions.set(entryId, (this.revisions.get(entryId) ?? 0) + 1);
      this.dropOpeningFrame(entryId);
      // The worker sends the new thumbnail, since the entry is still on screen.
      this.results.delete(entryId);
      this.notifyReaders(entryId);
    }
    const ids = new Set(entryIds);
    this.queries
      .invalidateQueries({ predicate: ({ queryKey }) => isQueryAbout(queryKey, ['original'], ids) })
      .catch(() => null);
  }

  clear() {
    for (const url of this.openingFrames.values()) {
      URL.revokeObjectURL(url);
    }
    this.openingFrames.clear();
    // Results start again from nothing, rather than showing the old ones meanwhile: after a
    // reset, the last result names a file that is gone, and an image of it stays broken once it
    // fails to load.
    this.results.clear();
    this.generation += 1;
    for (const listener of this.listeners) {
      listener();
    }
    for (const entryId of this.readers.keys()) {
      this.notifyReaders(entryId);
    }
  }
}
