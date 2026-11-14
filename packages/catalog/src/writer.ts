import { type PhotoFile, pruneExifCache } from '#cached-details';
import type { CatalogConnections } from '#connections';
import { type CatalogDatabase, catalogDatabase, transaction } from '#data/database';
import type { UnreadPhoto } from '#data/details';
import { isIndexed } from '#data/indexed-folders';
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
import { fillSummaries } from '#folder-summaries';
import { pruneCatalog } from '#pruning';
import { moveStored, rateStored, type StoredRatings } from '#stored-ratings';
import type { ViewOrder } from '#views';
import { type CatalogWrite, writeCatalog, type Written } from '#writes';
import type { Rating } from '@prism/shared';

/** What the catalog's writer answers. */
export interface CatalogWriterAPI {
  /** The number the catalog knows the library by, which the reader asks about. */
  library: () => number;
  write: (writes: CatalogWrite[]) => void;
  isIndexed: (directoryId: string) => boolean;
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

// Folders' tiles a build before them left unknown are worked out this many at a time, a
// transaction each, so writes the indexer and enricher send go between them.
const FILL_BATCH = 256;

/**
 * What the writer says unasked: a write committed, which views may have to show, and the
 * folders holding folders whose tiles it changed, whose subfolders the sidebar's tree reads again.
 */
export interface WriterEvent {
  changed: true;
  folders: string[];
}

/**
 * The writer of the catalog of the library at `root`: it applies what the indexer and enricher
 * send, and edits, in the order they arrive, and reads what they need to know of the catalog to
 * write it, so each of those reads sees every write before it. It tells of each write as it
 * commits, before answering it, so the reader hears of a write before its caller does. The
 * window's reads go to the reader, which never waits for it. Its methods are what its thread
 * answers, so what it keeps to itself is private.
 */
export class CatalogWriter implements CatalogWriterAPI {
  readonly #db: CatalogDatabase;
  readonly #stored: StoredRatings;
  readonly #library: number;
  readonly #emit: (event: WriterEvent) => void;
  readonly #details = detailsQueue();
  /** The open views, most recently used first, as the reader last told of them. */
  #views: QueuedView[] = [];
  #filling: NodeJS.Timeout | undefined;

  constructor(connections: CatalogConnections, root: string, emit: (event: WriterEvent) => void) {
    this.#db = catalogDatabase(connections.index);
    this.#stored = { db: catalogDatabase(connections.ratings), root };
    pruneCatalog(this.#db, root);
    pruneExifCache(this.#db);
    this.#library = registerLibrary(this.#db, root);
    this.#emit = emit;
    this.#fillLater();
  }

  /**
   * Works out the next batch of the tiles rows of a build before them left unknown, after the
   * calls waiting now, and so on until none is left. Reads never wait for it, as the reader has a
   * connection of its own, and reads one of those folders' tiles itself meanwhile.
   */
  #fillLater() {
    this.#filling = setTimeout(() => {
      let found = 0;
      let holding: string[] = [];
      transaction(this.#db, () => {
        ({ found, holding } = fillSummaries(this.#db, this.#library, FILL_BATCH));
      });
      if (found === 0) {
        this.#filling = undefined;
        return;
      }
      this.#emit({ changed: true, folders: holding });
      this.#fillLater();
    }, 0);
  }

  /** Stops working out tiles, as the connection closes. */
  close(): void {
    clearTimeout(this.#filling);
    this.#filling = undefined;
  }

  #apply(writes: CatalogWrite[]): Written {
    const written = writeCatalog(this.#db, this.#library, writes);
    // Details of a file that changed since they were read are read again once the catalog
    // lists it as it is now.
    markUnreadable(this.#details, written.missed);
    markReadable(this.#details, written.unread);
    this.#emit({ changed: true, folders: written.folders });
    return written;
  }

  foldersInside(directoryId: string): string[] {
    return foldersInside(this.#db, this.#library, directoryId);
  }

  isIndexed(directoryId: string): boolean {
    return isIndexed(this.#db, this.#library, directoryId);
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
    this.#emit({ changed: true, folders: [] });
  }

  rate(id: string, rating: Rating | null): void {
    rateStored(this.#stored, id, rating);
    this.#emit({ changed: true, folders: [] });
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
