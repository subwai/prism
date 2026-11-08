import { about } from '#data/queries';
import { createRequestQueue } from '#data/request-queue';
import { captureFrame, captureOpeningFrame } from '#data/video-frame';
import type { PhotoEntry, PhotosAPI, ThumbnailResult } from '@prism/shared';
import { type QueryClient, queryOptions } from '@tanstack/react-query';

const MAX_OPENING_FRAMES = 32;

export function originalKey(entryId: string) {
  return ['original', entryId] as const;
}

/** Thumbnails and originals: what the session has read of each photo's and video's contents. */
export interface MediaCache {
  thumbnailQuery: (entryId: string) => ReturnType<typeof thumbnailOptions>;
  /**
   * The original's URL, `null` if it is unavailable. Settles once a photo has decoded, or a
   * video's opening frame has, so a viewer suspended on it can keep the previous one on screen
   * until then.
   */
  originalQuery: (entry: PhotoEntry) => ReturnType<typeof originalOptions>;
  /** Lets queued work for `entryId` go ahead, now that it is wanted again. */
  wake: (entryId: string) => void;
  /** The frame a video starts on, once its original has loaded, to show until it plays. */
  peekOpeningFrame: (entryId: string) => string | undefined;
  /** Reads entries whose contents changed again, showing the old ones until then. */
  forget: (entryIds: string[]) => void;
  clear: () => void;
}

function thumbnailOptions(entryId: string, read: () => Promise<ThumbnailResult>) {
  return queryOptions({ queryFn: read, queryKey: ['thumbnail', entryId] });
}

function originalOptions(entryId: string, read: () => Promise<string | null>) {
  return queryOptions({ queryFn: read, queryKey: originalKey(entryId) });
}

/** Resolves once `url` has decoded as an image. */
async function decode(url: string) {
  const image = new Image();
  image.src = url;
  await image.decode();
}

/**
 * Thumbnails and originals are read for entries `wanted` on screen when their turn comes, so
 * pages the reader scrolls past quickly do not hold up the one it stops on.
 */
export function createMediaCache(
  api: PhotosAPI,
  queries: QueryClient,
  wanted: (entryId: string) => boolean,
): MediaCache {
  const thumbnails = createRequestQueue(4, wanted);
  const originals = createRequestQueue(4, wanted);
  /** How often each entry's contents changed on disk, so its original's URL changes too. */
  const revisions = new Map<string, number>();
  /** Object URLs of the frames videos start on, oldest first. */
  const openingFrames = new Map<string, string>();

  /** The query only defeats the browser's cache of the file as it was before a change. */
  async function originalURL(entryId: string) {
    const revision = revisions.get(entryId) ?? 0;
    return `${await api.getOriginalURL(entryId)}${revision ? `?v=${revision}` : ''}`;
  }

  /** A still taken here, for a video the system's thumbnailer cannot read, cached for good. */
  async function captureThumbnail(entryId: string) {
    const image = await captureFrame(await originalURL(entryId));
    return api.storeThumbnail({ entryId, image });
  }

  function dropOpeningFrame(entryId: string) {
    const url = openingFrames.get(entryId);
    if (url) {
      URL.revokeObjectURL(url);
      openingFrames.delete(entryId);
    }
  }

  /** A video that cannot be read here still plays, or fails, in the viewer, which says so. */
  async function captureOpening(entryId: string, url: string) {
    const frame = await captureOpeningFrame(url).catch(() => null);
    if (frame) {
      const frameURL = URL.createObjectURL(frame);
      // Decoded before the viewer switches, as a photo is, so the new video's poster paints in
      // its first frame instead of leaving the viewer empty for one.
      await decode(frameURL).catch(() => null);
      dropOpeningFrame(entryId);
      openingFrames.set(entryId, frameURL);
      // A few dozen are plenty for browsing back and forth.
      const [oldest] = openingFrames.keys();
      if (oldest !== undefined && openingFrames.size > MAX_OPENING_FRAMES) {
        dropOpeningFrame(oldest);
      }
    }
  }

  return {
    clear() {
      for (const url of openingFrames.values()) {
        URL.revokeObjectURL(url);
      }
      openingFrames.clear();
    },
    forget(entryIds) {
      if (entryIds.length === 0) {
        return;
      }
      for (const entryId of entryIds) {
        revisions.set(entryId, (revisions.get(entryId) ?? 0) + 1);
        dropOpeningFrame(entryId);
      }
      const ids = new Set(entryIds);
      queries
        .invalidateQueries({
          predicate: ({ queryKey }) => about(queryKey, ['thumbnail', 'original'], ids),
        })
        .catch(() => null);
    },
    originalQuery: (entry) =>
      originalOptions(entry.id, () =>
        originals.run(entry.id, async () => {
          try {
            const url = await originalURL(entry.id);
            await (entry.kind === 'video' ? captureOpening(entry.id, url) : decode(url));
            return url;
          } catch {
            return null;
          }
        }),
      ),
    peekOpeningFrame: (entryId) => openingFrames.get(entryId),
    thumbnailQuery: (entryId) =>
      thumbnailOptions(entryId, () =>
        thumbnails.run(entryId, () =>
          api
            .requestThumbnail(entryId)
            .then((result) =>
              result.status === 'frame-needed' ? captureThumbnail(entryId) : result,
            )
            .catch((error: unknown): ThumbnailResult => ({
              message: String(error),
              status: 'failed',
            })),
        ),
      ),
    wake(entryId) {
      thumbnails.wake(entryId);
      originals.wake(entryId);
    },
  };
}
