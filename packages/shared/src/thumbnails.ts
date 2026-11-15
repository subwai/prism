import type { PhotoEntry } from '#photos';

/**
 * Where the window finds `entry`'s thumbnail if it is cached already, with no call to make it
 * first: the main process serves the cached file, or answers 404 if there is none, and then the
 * worker makes one once the entry is on show, and tells of it (`ThumbnailNews`). The query says
 * what names the thumbnail, the file's inode, size and modified time, as the entry's listing had
 * them, so the main process finds the file with no call to the folder's worker or its catalog;
 * without an inode, the worker looks. It changes as the file does, and with `generation`, which a
 * refresh raises to have them read again.
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

/** A video's still, encoded as an image, taken by the window from the video itself. */
export interface ThumbnailFrame {
  entryId: string;
  image: Uint8Array;
}

export type ThumbnailResult =
  | { status: 'ready'; url: string }
  /** A video the system cannot render a still of; the window can, with `storeThumbnail`. */
  | { status: 'frame-needed' }
  | { status: 'failed'; message: string };

/**
 * The thumbnail of an entry the window shows, which the worker tells of unasked: once each time
 * the entry comes on show, as it finds it cached or makes it, and again after its contents change
 * or a refresh. One the window stops showing before its turn is not made, and is told once on show
 * again.
 */
export type ThumbnailNews = ThumbnailResult & { entryId: string };
