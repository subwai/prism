import type { CatalogDatabase } from '#data/database';
import { unreadAfter, unreadAmong, type UnreadPhoto } from '#data/details';
import type { ViewOrder } from '#views';

// How many of a view's entries are looked through at a time for photos without details.
const LOOK_AHEAD = 1024;

/**
 * Where the enricher's reading has got to in a library: how far the library has been looked
 * through for photos without details, and the photos whose details could not be read, which are
 * left out for the session until a read lists them afresh.
 */
export interface DetailsQueue {
  cursor: number;
  unreadable: Set<number>;
}

/** A view's order, and how far the details queue has looked through it for photos without details. */
export interface QueuedView extends ViewOrder {
  cursor: number;
}

/**
 * The views as `orders`, most recently used first, tells of them now. Each keeps how far it was
 * looked through while its version stays the same.
 */
export function followViews(views: QueuedView[], orders: ViewOrder[]): QueuedView[] {
  const known = new Map(views.map((view) => [view.viewId, view]));
  return orders.map((order) => {
    const was = known.get(order.viewId);
    return { ...order, cursor: was?.version === order.version ? was.cursor : 0 };
  });
}

export function detailsQueue(): DetailsQueue {
  return { cursor: 0, unreadable: new Set() };
}

/** Notes photos listed afresh without details, which may be read again. */
export function markReadable(queue: DetailsQueue, items: number[]): void {
  for (const item of items) {
    queue.unreadable.delete(item);
  }
}

export function markUnreadable(queue: DetailsQueue, items: number[]): void {
  for (const item of items) {
    queue.unreadable.add(item);
  }
}

/** Adds `photos` to `found` until it holds `limit`; says whether it wants more. */
function take(
  queue: DetailsQueue,
  found: Map<number, UnreadPhoto>,
  limit: number,
  photos: UnreadPhoto[],
) {
  for (const photo of photos) {
    if (found.size < limit && !queue.unreadable.has(photo.item)) {
      found.set(photo.item, photo);
    }
  }
  return found.size < limit;
}

/** Takes photos in the view's order from where it got to. */
function alongView(
  db: CatalogDatabase,
  view: QueuedView,
  wants: (photos: UnreadPhoto[]) => boolean,
) {
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
function alongLibrary(
  db: CatalogDatabase,
  library: number,
  queue: DetailsQueue,
  found: Map<number, UnreadPhoto>,
  limit: number,
) {
  let wrapped = queue.cursor === 0;
  while (found.size < limit) {
    const photos = unreadAfter(db, library, queue.cursor, LOOK_AHEAD);
    for (const photo of photos) {
      if (found.size >= limit) {
        return;
      }
      // Only what was looked at is passed over, so a full batch leaves the rest for the next.
      queue.cursor = photo.item;
      if (!queue.unreadable.has(photo.item)) {
        found.set(photo.item, photo);
      }
    }
    if (photos.length < LOOK_AHEAD) {
      // Photos whose files changed are unread again, however long ago they were added.
      if (wrapped) {
        return;
      }
      queue.cursor = 0;
      wrapped = true;
    }
  }
}

/**
 * Up to `limit` photos of `library` for the enricher to read, the most wanted first: those the
 * windows last showed, then the rest of the view used last, in its order, then the rest of the
 * library. `views` are most recently used first.
 */
export function nextUnread(
  db: CatalogDatabase,
  library: number,
  queue: DetailsQueue,
  limit: number,
  views: QueuedView[],
): UnreadPhoto[] {
  const found = new Map<number, UnreadPhoto>();
  const wants = (photos: UnreadPhoto[]) => take(queue, found, limit, photos);
  for (const view of views) {
    wants(unreadAmong(db, view.shown));
  }
  const [latest] = views;
  if (latest) {
    alongView(db, latest, wants);
  }
  alongLibrary(db, library, queue, found, limit);
  return [...found.values()];
}
