import { type PhotoFile, pruneExifCache } from '#cached-details';
import type { CatalogConnections } from '#connections';
import { type CatalogDatabase, catalogDatabase } from '#data/database';
import type { UnreadPhoto } from '#data/details';
import { foldersInside, type KnownItem, listing } from '#data/items';
import { registerLibrary } from '#data/libraries';
import {
  detailsQueue,
  followViews,
  markReadable,
  markUnreadable,
  nextUnread,
  type QueuedView,
} from '#details-queue';
import { keepSkeleton } from '#folder-skeleton';
import { pruneCatalog } from '#pruning';
import { moveStored, rateStored, type StoredRatings } from '#stored-ratings';
import type { ViewOrder } from '#views';
import { type CatalogWrite, type FolderNews, writeCatalog, type Written } from '#writes';
import type { Rating } from '@prism/shared';

// How long writes that change the skeleton must stop for before the writer makes it again, so
// the first read of a library, which changes it every quarter of a second, makes it once.
const SKELETON_QUIET_MS = 5000;

/** What the catalog's writer answers. */
export interface CatalogWriterAPI {
  /** The number the catalog knows the library by, which the reader asks about. */
  library: () => number;
  write: (writes: CatalogWrite[]) => void;
  foldersInside: (directoryId: string) => string[];
  listing: (directoryId: string) => KnownItem[];
  wanted: (limit: number) => UnreadPhoto[];
  /** Stores the details the cache has of `photos`; returns the IDs of those it has none of. */
  recall: (photos: PhotoFile[]) => string[];
  markUnreadable: (items: number[]) => void;
  /**
   * Keeps the rating of an entry that keeps none in a file of its own, such as a folder or a
   * video, or with `null` forgets it.
   */
  rate: (id: string, rating: Rating | null) => void;
  /** Moves the ratings kept of an entry, and everything inside it, as it is renamed. */
  moveRatings: (from: string, to: string) => void;
  /** The views' orders as the reader has them, most recently used first, for `wanted`. */
  useOrders: (orders: ViewOrder[]) => void;
}

/** What the writer says unasked: a write committed, which views may have to show. */
export interface WriterEvent extends FolderNews {
  changed: true;
}

/**
 * The writer of the catalog of the library at `root`: it applies what the indexer and enricher
 * send, and edits, in the order they arrive, and reads what they need to know of the catalog to
 * write it, so each of those reads sees every write before it. It tells of each write that
 * changed a row as it commits, before answering it, so the reader hears of a write before its
 * caller does. The window's reads go to the reader, which never waits for it. Its methods are
 * what its thread answers, so what it keeps to itself is private.
 */
export class CatalogWriter implements CatalogWriterAPI {
  readonly #db: CatalogDatabase;
  readonly #stored: StoredRatings;
  readonly #library: number;
  readonly #emit: (event: WriterEvent) => void;
  readonly #details = detailsQueue();
  /** The open views, most recently used first, as the reader last told of them. */
  #views: QueuedView[] = [];
  #keeping: ReturnType<typeof setTimeout> | undefined;

  constructor(connections: CatalogConnections, root: string, emit: (event: WriterEvent) => void) {
    this.#db = catalogDatabase(connections.index);
    this.#stored = { db: catalogDatabase(connections.ratings), root };
    pruneCatalog(this.#db, root);
    pruneExifCache(this.#db);
    this.#library = registerLibrary(this.#db, root);
    this.#emit = emit;
    // One a write deleted as the last session closed, or that no session made, is made now.
    this.#keepSkeletonLater();
  }

  /**
   * Makes the skeleton ready-made once writes that change it stop, here rather than on the
   * reader, so the window's reads never wait for it.
   */
  #keepSkeletonLater() {
    clearTimeout(this.#keeping);
    this.#keeping = setTimeout(() => {
      try {
        keepSkeleton(this.#db, this.#library);
      } catch {
        // Without it, the reader reads the folders' rows instead, as slowly as ever.
      }
    }, SKELETON_QUIET_MS);
  }

  /** Stops making the skeleton, as the catalog closes. */
  close(): void {
    clearTimeout(this.#keeping);
  }

  #apply(writes: CatalogWrite[]): Written {
    const written = writeCatalog(this.#db, this.#library, writes);
    // Details of a file that changed since they were read are read again once the catalog
    // lists it as it is now.
    markUnreadable(this.#details, written.missed);
    markReadable(this.#details, written.unread);
    // A write that changed no row, as a read of the library again mostly is, leaves views as
    // they are.
    if (written.changed) {
      this.#emit({ changed: true, folders: written.folders, tiles: written.tiles });
    }
    if (written.reshaped) {
      this.#keepSkeletonLater();
    }
    return written;
  }

  foldersInside(directoryId: string): string[] {
    return foldersInside(this.#db, this.#library, directoryId);
  }

  library(): number {
    return this.#library;
  }

  listing(directoryId: string): KnownItem[] {
    return listing(this.#db, this.#library, directoryId);
  }

  markUnreadable(items: number[]): void {
    markUnreadable(this.#details, items);
  }

  moveRatings(from: string, to: string): void {
    moveStored(this.#stored, from, to);
    // A change of ratings may change what views show.
    this.#emit({ changed: true, folders: [], tiles: [] });
  }

  rate(id: string, rating: Rating | null): void {
    rateStored(this.#stored, id, rating);
    this.#emit({ changed: true, folders: [], tiles: [] });
  }

  recall(photos: PhotoFile[]): string[] {
    return photos.length > 0 ? this.#apply([{ recalled: photos }]).uncached : [];
  }

  useOrders(orders: ViewOrder[]): void {
    this.#views = followViews(this.#views, orders);
  }

  wanted(limit: number): UnreadPhoto[] {
    return nextUnread(this.#db, this.#library, this.#details, limit, this.#views);
  }

  write(writes: CatalogWrite[]): void {
    if (writes.length > 0) {
      this.#apply(writes);
    }
  }
}
