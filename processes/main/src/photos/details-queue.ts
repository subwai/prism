import type { CatalogQueries, UnreadPhoto } from '#photos/catalog-queries';
import type { ViewOrder } from '#photos/catalog-views';

// How many of a view's entries are looked through at a time for photos without details.
const LOOK_AHEAD = 1024;

/**
 * Which photos the enricher reads next: those the windows last showed, then the rest of the
 * view used last, in its order, then the rest of the library. Photos whose details could not
 * be read are left out for the session, until a read lists them afresh.
 */
export class DetailsQueue {
  private readonly unreadable = new Set<number>();
  /** How far the library has been looked through for photos without details. */
  private cursor = 0;

  constructor(private readonly queries: CatalogQueries) {}

  markUnreadable(items: number[]): void {
    for (const item of items) {
      this.unreadable.add(item);
    }
  }

  /** Notes photos listed afresh without details, which may be read again. */
  markReadable(items: number[]): void {
    for (const item of items) {
      this.unreadable.delete(item);
    }
  }

  /** Up to `limit` photos to read, the most wanted first; `views` most recently used first. */
  next(limit: number, views: ViewOrder[]): UnreadPhoto[] {
    const found = new Map<number, UnreadPhoto>();
    const take = (photos: UnreadPhoto[]) => {
      for (const photo of photos) {
        if (found.size < limit && !this.unreadable.has(photo.item)) {
          found.set(photo.item, photo);
        }
      }
      return found.size < limit;
    };
    for (const view of views) {
      take(this.queries.unreadAmong(view.shown));
    }
    const [latest] = views;
    if (latest) {
      this.alongView(latest, take);
    }
    this.alongLibrary(found, limit);
    return [...found.values()];
  }

  /** Takes photos in the view's order from where it got to. */
  private alongView(view: ViewOrder, take: (photos: UnreadPhoto[]) => boolean) {
    while (view.cursor < view.items.length) {
      const chunk = [...view.items.subarray(view.cursor, view.cursor + LOOK_AHEAD)];
      // A chunk is looked at again until its photos have all been read.
      if (!take(this.queries.unreadAmong(chunk))) {
        return;
      }
      view.cursor += LOOK_AHEAD;
    }
  }

  /** Takes photos of the library, by number, from where it got to. */
  private alongLibrary(found: Map<number, UnreadPhoto>, limit: number) {
    let wrapped = this.cursor === 0;
    while (found.size < limit) {
      const photos = this.queries.unreadAfter(this.cursor, LOOK_AHEAD);
      for (const photo of photos) {
        if (found.size >= limit) {
          return;
        }
        // Only what was looked at is passed over, so a full batch leaves the rest for the next.
        this.cursor = photo.item;
        if (!this.unreadable.has(photo.item)) {
          found.set(photo.item, photo);
        }
      }
      if (photos.length < LOOK_AHEAD) {
        // Photos whose files changed are unread again, however long ago they were added.
        if (wrapped) {
          return;
        }
        this.cursor = 0;
        wrapped = true;
      }
    }
  }
}
