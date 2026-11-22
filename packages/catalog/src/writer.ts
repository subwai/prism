import type { CatalogConnections } from '#connections';
import { type CatalogDatabase, catalogDatabase } from '#data/database';
import type { UnreadPhoto } from '#data/details';
import { detailsCount, keepDetailsCount } from '#data/details-count';
import { foldersInside, type KnownItem, listing } from '#data/items';
import { registerLibrary } from '#data/libraries';
import {
  detailsQueue,
  followViews,
  nextUnread,
  type QueuedView,
  skip,
  unskip,
} from '#details-queue';
import { keepSkeleton, skeletonText } from '#folder-skeleton';
import type { MakingNews } from '#making';
import { moveInCatalog } from '#moves';
import { pruneCatalog } from '#pruning';
import { type PhotoFile, pruneRemovedDetails } from '#recalled-details';
import { moveStored, rateStored, type StoredRatings } from '#stored-ratings';
import type { ViewOrder } from '#views';
import { type CatalogWrite, type FolderNews, writeCatalog, type Written } from '#writes';
import type { DetailsProgress, Rating } from '@prism/shared';

// How long writes that change the skeleton must stop for before the writer makes it again, so
// the first read of a library, which changes it every quarter of a second, makes it once.
const SKELETON_QUIET_MS = 5000;
// A change of ratings, which may change what views show, but no row of the index.
const RATED = { folders: [], onlyDetails: false, tiles: [] };

/** What the catalog's writer answers. */
export interface CatalogWriterAPI {
  /** The number the catalog knows the library by, which the reader asks about. */
  library: () => number;
  write: (writes: CatalogWrite[]) => void;
  foldersInside: (directoryId: string) => string[];
  listing: (directoryId: string) => KnownItem[];
  wanted: (limit: number) => UnreadPhoto[];
  /**
   * Stores the details the catalog kept before of `photos`; returns the IDs of those it has none
   * of, whose files are to be read.
   */
  recall: (photos: PhotoFile[]) => string[];
  /**
   * Leaves `items` out of `wanted` until a read lists them afresh, as photos whose details failed
   * while the library's folder could not be reached, which stay unread for a later session.
   */
  skip: (items: number[]) => void;
  /**
   * Keeps the rating of an entry that keeps none in a file of its own, such as a folder or a
   * video, or with `null` forgets it.
   */
  rate: (id: string, rating: Rating | null) => void;
  /**
   * Moves an entry's rows and kept ratings, and those of everything inside it, as the app renamed
   * or moved it. Returns `false` if the catalog cannot move its rows, which it then leaves as
   * they are; see `moveInCatalog`.
   */
  move: (from: string, to: string) => boolean;
  /** Moves the ratings kept of an entry, and everything inside it, as it is renamed. */
  moveRatings: (from: string, to: string) => void;
  /**
   * Counts the library's photos, and those whose details are read, which it then keeps current
   * and tells as they change: first once the reader has started, as counting reads every photo's
   * row, which takes a second from a cold disk, and again after another connection forgot every
   * photo's details; see `keepDetailsCount`.
   */
  countDetails: () => void;
  /** The views' orders as the reader has them, most recently used first, for `wanted`. */
  useOrders: (orders: ViewOrder[]) => void;
  /**
   * Every folder of the library, as the text of a `FolderSkeleton`: the one kept, or made now,
   * here rather than on the reader, so the window's reads never wait behind making it.
   */
  wholeSkeleton: () => string;
}

/**
 * What the writer says unasked: a write committed, which views may have to show, whether it
 * changed `onlyDetails`, and how many of the library's photos are `unread` after it, that it is making the skeleton, or how many of the library's photos
 * have their details read, as it changes.
 */
export type WriterEvent =
  | ({ changed: true; onlyDetails: boolean; unread: number | undefined } & FolderNews)
  | MakingNews
  | { details: DetailsProgress };

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
  /** How many photos have their details read, of how many, as last told, once counted. */
  #counted: DetailsProgress | undefined;

  constructor(connections: CatalogConnections, root: string, emit: (event: WriterEvent) => void) {
    this.#db = catalogDatabase(connections.index);
    this.#stored = { db: catalogDatabase(connections.ratings), root };
    pruneCatalog(this.#db, root);
    pruneRemovedDetails(this.#db);
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
      this.#emit({ busy: true, making: 'skeleton' });
      try {
        keepSkeleton(this.#db, this.#library);
      } catch {
        // Without it, the reader reads the folders' rows instead, as slowly as ever.
      } finally {
        this.#emit({ busy: false, making: 'skeleton' });
      }
    }, SKELETON_QUIET_MS);
  }

  /** Stops making the skeleton, as the catalog closes. */
  close(): void {
    clearTimeout(this.#keeping);
  }

  #apply(writes: CatalogWrite[]): Written {
    const written = writeCatalog(this.#db, this.#library, writes);
    this.#tell(written);
    return written;
  }

  /** Tells of what `written` changed, which views and the tree may show. */
  #tell(written: Written) {
    // Details of a file that changed since they were read are read again once the catalog
    // lists it as it is now.
    skip(this.#details, written.missed);
    unskip(this.#details, written.unread);
    // Until it is counted, the count's table and triggers are not there yet.
    if (this.#counted) {
      this.#tellDetails();
    }
    // A write that changed no row, as a read of the library again mostly is, leaves views as
    // they are.
    if (written.changed) {
      this.#tellChanged(written);
    }
    if (written.reshaped) {
      this.#keepSkeletonLater();
    }
  }

  /**
   * Tells of a write that committed, with how many of the library's photos still lack details,
   * once counted, which the reader takes for views of the whole library rather than counting
   * them again.
   */
  #tellChanged({ folders, onlyDetails, tiles }: FolderNews & { onlyDetails: boolean }) {
    const counted = this.#counted;
    const unread = counted && counted.photos - counted.read;
    this.#emit({ changed: true, folders, onlyDetails, tiles, unread });
  }

  /** Tells how many photos have their details read, if that changed since it last told. */
  #tellDetails() {
    const count = detailsCount(this.#db);
    const was = this.#counted;
    if (
      count.read !== was?.read ||
      count.photos !== was.photos ||
      count.unreadable !== was.unreadable
    ) {
      this.#counted = count;
      this.#emit({ details: count });
    }
  }

  countDetails(): void {
    keepDetailsCount(this.#db, this.#library);
    this.#tellDetails();
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

  move(from: string, to: string): boolean {
    // Kept ratings go by path, so they follow whether or not the rows can.
    moveStored(this.#stored, from, to);
    const written = moveInCatalog(this.#db, this.#library, from, to);
    if (written) {
      this.#tell(written);
    } else {
      this.#tellChanged(RATED);
    }
    return written !== null;
  }

  moveRatings(from: string, to: string): void {
    moveStored(this.#stored, from, to);
    this.#tellChanged(RATED);
  }

  rate(id: string, rating: Rating | null): void {
    rateStored(this.#stored, id, rating);
    this.#tellChanged(RATED);
  }

  recall(photos: PhotoFile[]): string[] {
    return photos.length > 0 ? this.#apply([{ recalled: photos }]).unrecalled : [];
  }

  skip(items: number[]): void {
    skip(this.#details, items);
  }

  useOrders(orders: ViewOrder[]): void {
    this.#views = followViews(this.#views, orders);
  }

  wanted(limit: number): UnreadPhoto[] {
    return nextUnread(this.#db, this.#library, this.#details, limit, this.#views);
  }

  wholeSkeleton(): string {
    return skeletonText(this.#db, this.#library);
  }

  write(writes: CatalogWrite[]): void {
    if (writes.length > 0) {
      this.#apply(writes);
    }
  }
}
