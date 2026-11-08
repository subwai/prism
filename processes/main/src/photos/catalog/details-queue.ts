import type { CatalogDatabase } from '#photos/catalog/data/database';
import { unreadAfter, unreadAmong, type UnreadPhoto } from '#photos/catalog/data/details';
import type { ViewOrder } from '#photos/catalog/views';

// How many of a view's entries are looked through at a time for photos without details.
const LOOK_AHEAD = 1024;

export type DetailsQueue = ReturnType<typeof createDetailsQueue>;

/**
 * Which photos the enricher reads next: those the windows last showed, then the rest of the
 * view used last, in its order, then the rest of the library. Photos whose details could not
 * be read are left out for the session, until a read lists them afresh.
 */
export function createDetailsQueue(db: CatalogDatabase, library: number) {
  const unreadable = new Set<number>();
  /** How far the library has been looked through for photos without details. */
  let cursor = 0;

  /** Adds `photos` to `found` until it holds `limit`; says whether it wants more. */
  function take(found: Map<number, UnreadPhoto>, limit: number, photos: UnreadPhoto[]) {
    for (const photo of photos) {
      if (found.size < limit && !unreadable.has(photo.item)) {
        found.set(photo.item, photo);
      }
    }
    return found.size < limit;
  }

  /** Takes photos in the view's order from where it got to. */
  function alongView(view: ViewOrder, wants: (photos: UnreadPhoto[]) => boolean) {
    while (view.cursor < view.items.length) {
      const chunk = [...view.items.subarray(view.cursor, view.cursor + LOOK_AHEAD)];
      // A chunk is looked at again until its photos have all been read.
      if (!wants(unreadAmong(db, chunk))) {
        return;
      }
      view.cursor += LOOK_AHEAD;
    }
  }

  /** Takes photos of the library, by number, from where it got to. */
  function alongLibrary(found: Map<number, UnreadPhoto>, limit: number) {
    let wrapped = cursor === 0;
    while (found.size < limit) {
      const photos = unreadAfter(db, library, cursor, LOOK_AHEAD);
      for (const photo of photos) {
        if (found.size >= limit) {
          return;
        }
        // Only what was looked at is passed over, so a full batch leaves the rest for the next.
        cursor = photo.item;
        if (!unreadable.has(photo.item)) {
          found.set(photo.item, photo);
        }
      }
      if (photos.length < LOOK_AHEAD) {
        // Photos whose files changed are unread again, however long ago they were added.
        if (wrapped) {
          return;
        }
        cursor = 0;
        wrapped = true;
      }
    }
  }

  return {
    /** Notes photos listed afresh without details, which may be read again. */
    markReadable(items: number[]): void {
      for (const item of items) {
        unreadable.delete(item);
      }
    },

    markUnreadable(items: number[]): void {
      for (const item of items) {
        unreadable.add(item);
      }
    },

    /** Up to `limit` photos to read, the most wanted first; `views` most recently used first. */
    next(limit: number, views: ViewOrder[]): UnreadPhoto[] {
      const found = new Map<number, UnreadPhoto>();
      const wants = (photos: UnreadPhoto[]) => take(found, limit, photos);
      for (const view of views) {
        wants(unreadAmong(db, view.shown));
      }
      const [latest] = views;
      if (latest) {
        alongView(latest, wants);
      }
      alongLibrary(found, limit);
      return [...found.values()];
    },
  };
}
