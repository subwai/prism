import type { PhotoEntry } from '#photos';

/**
 * Returns the URL where the window loads `entry`'s thumbnail, if it is already cached, without
 * first asking for it to be made. The main process serves the cached file, or answers 404 if
 * there is none. In that case the worker makes the thumbnail once the entry is on screen, and
 * sends it as a `ThumbnailUpdate`.
 *
 * The query holds what the cache names a thumbnail by: the file's inode, size and modified
 * time, as the entry's listing had them. That lets the main process find the cached file
 * without asking the worker or the catalog. Without an inode, the worker looks it up instead.
 * The URL changes when the file does, and when `generation` goes up, which a refresh does so
 * the window loads every thumbnail again.
 */
export function cachedThumbnailURL(session: string, entry: PhotoEntry, generation = 0): string {
  const { metadata } = entry;
  const query = new URLSearchParams({ generation: String(generation) });
  if (metadata) {
    query.set('size', String(metadata.size));
    query.set('modified', String(metadata.modifiedMs));
  }
  if (metadata?.inode !== undefined) {
    query.set('inode', metadata.inode);
  }
  return `media://thumbnail/${session}/${encodeURIComponent(entry.id)}?${query.toString()}`;
}

/** A still image of a video, which the window took from the video itself. */
export interface ThumbnailFrame {
  entryId: string;
  /** The still, encoded as an image file. */
  image: Uint8Array;
}

/** What asking for a thumbnail gives. */
export type ThumbnailResult =
  | { status: 'ready'; url: string }
  /**
   * A video the system cannot take a still of. The window can, and sends it with
   * `storeThumbnail`.
   */
  | { status: 'frame-needed' }
  | { status: 'failed'; message: string };

/**
 * A thumbnail the worker made, or failed to make, which it sends to the window without being
 * asked. That happens for entries on screen and for entries just ahead of the scroll. The window
 * keeps the updates for the entries it shows and for tiles mounted just off screen. Thumbnails
 * already cached are not sent, as the window loads those itself.
 */
export type ThumbnailUpdate = ThumbnailResult & { entryId: string };
