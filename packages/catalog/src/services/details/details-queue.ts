import type { CatalogDatabase } from '#database/catalog-database';
import { unreadAfter, type UnreadPhoto, unreadPhotosOf } from '#repositories/entries/details';
import type { ViewOrder } from '#services/views/catalog-views';

// How many of a view's entries are looked through at a time for photos without details.
const LOOK_AHEAD = 1024;

/**
 * Where the details reader's reading has got to in a library: how far the library has been looked
 * through for photos without details, and the photos skipped, which are left out for the session
 * until a read lists them afresh: those whose files changed since they were read, and those that
 * failed while the library's folder could not be reached, which the catalog keeps unread.
 */
export interface DetailsQueue {
  cursor: number;
  skipped: Set<number>;
}

/** A view's order, and how far the details queue has looked through it for photos without details. */
export interface QueuedView extends ViewOrder {
  cursor: number;
}

/**
 * The views as `orders`, most recently used first, tells of them now. Each keeps how far it was
 * looked through while its version stays the same.
 */
export function updateQueuedViews(views: QueuedView[], orders: ViewOrder[]): QueuedView[] {
  const known = new Map(views.map((view) => [view.viewId, view]));
  return orders.map((order) => {
    const was = known.get(order.viewId);
    return { ...order, cursor: was?.version === order.version ? was.cursor : 0 };
  });
}

export function detailsQueue(): DetailsQueue {
  return { cursor: 0, skipped: new Set() };
}

/** Notes photos listed afresh without details, which may be read again. */
export function stopSkipping(queue: DetailsQueue, entries: number[]): void {
  for (const entry of entries) {
    queue.skipped.delete(entry);
  }
}

/** Reads every skipped photo again, as after every photo's details were forgotten. */
export function stopSkippingAll(queue: DetailsQueue): void {
  queue.skipped.clear();
}

export function skip(queue: DetailsQueue, entries: number[]): void {
  for (const entry of entries) {
    queue.skipped.add(entry);
  }
}

/**
 * Photos of `view` without details, in its order, from where the queue got to. The cursor moves
 * past a chunk only after the caller has taken every photo in it and asks for more. So a chunk is
 * looked at again until all its photos are read.
 */
function* alongView(db: CatalogDatabase, view: QueuedView): Generator<UnreadPhoto> {
  while (view.cursor < view.entries.length) {
    yield* unreadPhotosOf(db, [...view.entries.subarray(view.cursor, view.cursor + LOOK_AHEAD)]);
    view.cursor += LOOK_AHEAD;
  }
}

/**
 * Photos of the library without details, by number, from where the queue got to, and then once
 * more from the start: photos whose files changed are unread again, however long ago they were
 * added.
 */
function* alongLibrary(
  db: CatalogDatabase,
  library: number,
  queue: DetailsQueue,
): Generator<UnreadPhoto> {
  let wrapped = queue.cursor === 0;
  while (true) {
    const photos = unreadAfter(db, library, queue.cursor, LOOK_AHEAD);
    for (const photo of photos) {
      // The cursor moves only past photos the caller has taken. A call that stops early leaves
      // the rest for the next one.
      queue.cursor = photo.entry;
      yield photo;
    }
    if (photos.length < LOOK_AHEAD) {
      if (wrapped) {
        return;
      }
      queue.cursor = 0;
      wrapped = true;
    }
  }
}

/** What `nextUnread` picks from. */
interface UnreadSources {
  queue: DetailsQueue;
  /** The open views, most recently used first. */
  views: QueuedView[];
}

/**
 * Photos without details, the most wanted first: those the windows last showed, then the rest of
 * the view used last, in its order, then the rest of the library.
 */
function* unreadInOrder(
  db: CatalogDatabase,
  library: number,
  { queue, views }: UnreadSources,
): Generator<UnreadPhoto> {
  for (const view of views) {
    yield* unreadPhotosOf(db, view.shown);
  }
  const [latest] = views;
  if (latest) {
    yield* alongView(db, latest);
  }
  yield* alongLibrary(db, library, queue);
}

/**
 * Up to `limit` photos of `library` for the details reader to read, the most wanted first, leaving
 * out those skipped. It stops as soon as it has `limit`, so the queue's cursors stay on the last
 * photo it took, and the next call carries on from there.
 */
export function nextUnread(
  db: CatalogDatabase,
  library: number,
  { limit, ...sources }: UnreadSources & { limit: number },
): UnreadPhoto[] {
  const found = new Map<number, UnreadPhoto>();
  for (const photo of unreadInOrder(db, library, sources)) {
    if (!sources.queue.skipped.has(photo.entry)) {
      found.set(photo.entry, photo);
    }
    if (found.size >= limit) {
      break;
    }
  }
  return [...found.values()];
}
