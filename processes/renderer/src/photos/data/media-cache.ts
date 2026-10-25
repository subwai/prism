import { RequestQueue } from '#photos/data/request-queue';
import { ResourceCache } from '#photos/data/resource-cache';
import { carryOver, keep, peek } from '#photos/data/stale';
import { captureFrame, captureOpeningFrame } from '#photos/data/video-frame';
import type { PhotoEntry, PhotosAPI, ThumbnailResult } from '@prism/shared';

const MAX_OPENING_FRAMES = 32;

/** Thumbnails and originals: what the session has read of each photo's and video's contents. */
export class MediaCache {
  private readonly thumbnails = new ResourceCache<ThumbnailResult>(new RequestQueue(4), 512);
  private readonly originals = new ResourceCache<string | null>(new RequestQueue(4), 256);
  // Old thumbnails keep rendering until fresh ones replace them.
  private staleThumbnails = new Map<string, ThumbnailResult>();
  /** How often each entry's contents changed on disk, so its original's URL changes too. */
  private readonly revisions = new Map<string, number>();
  /** Object URLs of the frames videos start on, oldest first. */
  private readonly openingFrames = new Map<string, string>();

  constructor(private readonly api: PhotosAPI) {}

  /** `wanted` is checked when the request reaches the front of the queue. */
  thumbnail(entryId: string, wanted: () => boolean) {
    return this.thumbnails.read(
      entryId,
      () =>
        this.api
          .requestThumbnail({ entryId, preset: 'grid', requestId: crypto.randomUUID() })
          .then((result) =>
            result.status === 'frame-needed' ? this.captureThumbnail(entryId) : result
          )
          .catch((error: unknown): ThumbnailResult => ({
            message: String(error),
            status: 'failed'
          })),
      wanted
    );
  }

  peekThumbnail(entryId: string) {
    return peek(this.thumbnails, this.staleThumbnails, entryId);
  }

  /** A still taken here, for a video the system's thumbnailer cannot read, cached for good. */
  private async captureThumbnail(entryId: string) {
    const image = await captureFrame(await this.originalURL(entryId));
    return this.api.storeThumbnail({ entryId, image });
  }

  /** The query only defeats the browser's cache of the file as it was before a change. */
  private async originalURL(entryId: string) {
    const revision = this.revision(entryId);
    return `${await this.api.getOriginalURL(entryId)}${revision ? `?v=${revision}` : ''}`;
  }

  /**
   * Original URLs are stable for a session; `null` if the photo is unavailable. Settles once
   * a photo has decoded, or a video's opening frame has, so a viewer suspended on it can keep
   * the previous one on screen until then.
   */
  original(entry: PhotoEntry) {
    return this.originals.read(entry.id, async () => {
      try {
        const url = await this.originalURL(entry.id);
        if (entry.kind === 'video') {
          await this.captureOpening(entry.id, url);
          return url;
        }
        const image = new Image();
        image.src = url;
        await image.decode();
        return url;
      } catch {
        return null;
      }
    });
  }

  /** A video that cannot be read here still plays, or fails, in the viewer, which says so. */
  private async captureOpening(entryId: string, url: string) {
    const frame = await captureOpeningFrame(url).catch(() => null);
    if (frame) {
      this.dropOpeningFrame(entryId);
      this.openingFrames.set(entryId, URL.createObjectURL(frame));
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

  peekOriginal(entryId: string) {
    const settled = this.originals.peek(entryId);
    return settled && { fresh: true, value: settled.value };
  }

  /** How often the entry's contents changed on disk this session; views key reads by it. */
  revision(entryId: string) {
    return this.revisions.get(entryId) ?? 0;
  }

  /** Forgets an entry whose contents changed, showing its old thumbnail until the new one. */
  forget(entryId: string) {
    this.revisions.set(entryId, this.revision(entryId) + 1);
    this.originals.evict(entryId);
    this.dropOpeningFrame(entryId);
    keep(this.staleThumbnails, entryId, this.thumbnails.evict(entryId));
    this.staleThumbnails = carryOver(this.staleThumbnails, new Map(), 512);
  }

  clear() {
    this.originals.clear();
    for (const url of this.openingFrames.values()) {
      URL.revokeObjectURL(url);
    }
    this.openingFrames.clear();
    this.staleThumbnails = carryOver(this.staleThumbnails, this.thumbnails.clear(), 512);
  }
}
