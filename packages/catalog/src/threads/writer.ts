import { type CatalogDatabase, catalogDatabase } from '#database/catalog-database';
import type { CatalogConnections } from '#database/connections';
import {
  detailsQueue,
  nextUnread,
  type QueuedView,
  skip,
  stopSkipping,
  updateQueuedViews,
} from '#details/details-queue';
import { type PhotoFile, pruneRemovedDetails } from '#details/reusable-details';
import { moveStored, rateStored, type StoredRatings } from '#ratings/stored-ratings';
import { detailsCount, keepDetailsCount } from '#repositories/details-count';
import { foldersInside } from '#repositories/folders';
import type { UnreadPhoto } from '#repositories/items/details';
import { type KnownItem, knownItemsIn } from '#repositories/items/entries';
import { registerLibrary } from '#repositories/libraries';
import type { BusyChange } from '#threads/busy-change';
import { storeTreeListing, wholeTreeListingText } from '#tree/tree-listing';
import type { ViewOrder } from '#views/catalog-views';
import { moveInCatalog } from '#writes/moves';
import { pruneCatalog } from '#writes/pruning';
import { type CatalogWrite, writeCatalog } from '#writes/write-catalog';
import type { TreeChanges, WriteResult } from '#writes/write-result';
import type { DetailsProgress, Rating } from '@prism/shared';

// How long writes that change the tree must stop before the writer stores its listing again. The
// first read of a library changes the tree every quarter of a second, so this way it is stored
// once, not on every write.
const TREE_LISTING_QUIET_MS = 5000;
// What a rating change reports. It changes no row of the index, but views that filter or sort by
// rating may still show something different.
const RATINGS_ONLY_CHANGE = { folders: [], onlyDetails: false, tiles: [] };

/** What the catalog's writer answers. */
export interface CatalogWriterAPI {
  /** The library's number in the catalog. The reader needs it to start. */
  library: () => number;
  write: (writes: CatalogWrite[]) => void;
  foldersInside: (directoryId: string) => string[];
  knownItemsIn: (directoryId: string) => KnownItem[];
  photosToRead: (limit: number) => UnreadPhoto[];
  /**
   * Reuses details the catalog already read for `photos`, from before a move or from another
   * library; see `findReusableDetails`. Returns the IDs of the photos it had none for, whose
   * files still have to be read.
   */
  reuseDetails: (photos: PhotoFile[]) => string[];
  /**
   * Leaves the photos numbered `items` out of `photosToRead` until a read lists them again. The
   * enricher skips photos whose details failed while the share was offline: they stay unread in
   * the catalog, so a later session tries them again.
   */
  skip: (items: number[]) => void;
  /**
   * Stores the rating of an entry that can't keep one in its own file, such as a folder or a
   * video. `null` removes it.
   */
  rate: (id: string, rating: Rating | null) => void;
  /**
   * Moves an entry's rows and stored ratings, and those of everything inside it, after the app
   * renamed or moved it. Returns `false` if the catalog can't move the rows, and then leaves them
   * as they are; see `moveInCatalog`.
   */
  move: (from: string, to: string) => boolean;
  /** Moves the stored ratings of an entry, and of everything inside it, as it is renamed. */
  moveRatings: (from: string, to: string) => void;
  /**
   * Counts the library's photos and how many have their details read, then keeps the count
   * current and reports it as it changes; see `keepDetailsCount`. The client calls it once the
   * reader has started, because counting reads every photo's row, which takes a second from a
   * cold disk. It is called again after another connection forgot every photo's details.
   */
  countDetails: () => void;
  /** The open views' orders, most recently used first, which `photosToRead` follows. */
  useOrders: (orders: ViewOrder[]) => void;
  /**
   * Every folder of the library, as the text of a `TreeListing`: the stored one, or one built
   * now. It is built here rather than on the reader, so the window's reads never wait for it.
   */
  listWholeTree: () => string;
}

/**
 * What the writer sends without being asked:
 * - a write committed, with whether it changed only photos' details (`onlyDetails`), how many of
 *   the library's photos are still `unread` once counted, and what changed in the tree;
 * - a large job started or stopped (`BusyChange`);
 * - how many of the library's photos have their details read, when that changes.
 */
export type WriterEvent =
  | ({ kind: 'changed'; onlyDetails: boolean; unread: number | undefined } & TreeChanges)
  | BusyChange
  | { kind: 'details'; details: DetailsProgress };

/**
 * The catalog's writer for the library at `root`. It applies the indexer's and enricher's writes
 * and the user's edits in the order they arrive. It also answers the reads those two need in
 * order to write, so each such read sees every write sent before it.
 *
 * Each write that changed a row is reported as it commits, before the writer answers it. So the
 * reader always learns of a write before the caller that sent it does. The window's reads go to
 * the reader, and the reader never waits for the writer.
 *
 * Its public methods are what its thread answers, so everything else is private.
 */
export class CatalogWriter implements CatalogWriterAPI {
  readonly #db: CatalogDatabase;
  readonly #stored: StoredRatings;
  readonly #library: number;
  readonly #emit: (event: WriterEvent) => void;
  readonly #details = detailsQueue();
  /** The open views, most recently used first, as the reader last reported them. */
  #views: QueuedView[] = [];
  /** The timer that stores the tree listing once writes go quiet. */
  #storeTimer: ReturnType<typeof setTimeout> | undefined;
  /** How many photos have their details read, as last reported; unset until counted. */
  #counted: DetailsProgress | undefined;

  constructor(connections: CatalogConnections, root: string, emit: (event: WriterEvent) => void) {
    this.#db = catalogDatabase(connections.index);
    this.#stored = { db: catalogDatabase(connections.ratings), root };
    pruneCatalog(this.#db, root);
    pruneRemovedDetails(this.#db);
    this.#library = registerLibrary(this.#db, root);
    this.#emit = emit;
    // The last session may have closed after a write deleted the stored listing, or never
    // stored one, so it is stored now if missing.
    this.#storeTreeListingLater();
  }

  /**
   * Stores the whole tree's listing once writes that change it stop. It is built here rather
   * than on the reader, so the window's reads never wait for it.
   */
  #storeTreeListingLater() {
    clearTimeout(this.#storeTimer);
    this.#storeTimer = setTimeout(() => {
      this.#emit({ activity: 'rebuildingTree', busy: true, kind: 'busy' });
      try {
        storeTreeListing(this.#db, this.#library);
      } catch {
        // Without a stored listing, the tree is built from the folders' rows on each read, which
        // is slow but still correct.
      } finally {
        this.#emit({ activity: 'rebuildingTree', busy: false, kind: 'busy' });
      }
    }, TREE_LISTING_QUIET_MS);
  }

  /** Stops the pending tree listing store, as the catalog closes. */
  close(): void {
    clearTimeout(this.#storeTimer);
  }

  #writeAndReport(writes: CatalogWrite[]): WriteResult {
    const result = writeCatalog(this.#db, this.#library, writes);
    this.#report(result);
    return result;
  }

  /** Reports what a write changed, which views and the tree may need to show. */
  #report(result: WriteResult) {
    // A photo whose file changed since its details were read is skipped until a read lists the
    // file as it is now. That listing marks it unread again, which ends the skip.
    skip(this.#details, result.changedSinceRead);
    stopSkipping(this.#details, result.newlyUnread);
    // Until `countDetails` runs, the count's table and triggers don't exist yet.
    if (this.#counted) {
      this.#reportDetails();
    }
    // A write that changed no row leaves views as they are. Most writes during a repeat read of
    // the library are like that.
    if (result.changed) {
      this.#reportChanged(result);
    }
    if (result.treeChanged) {
      this.#storeTreeListingLater();
    }
  }

  /**
   * Reports a committed write. Once the photos are counted, it includes how many of the
   * library's photos still lack details, so the reader doesn't count them again for views of
   * the whole library.
   */
  #reportChanged({ folders, onlyDetails, tiles }: TreeChanges & { onlyDetails: boolean }) {
    const counted = this.#counted;
    const unread = counted && counted.photos - counted.read;
    this.#emit({ folders, kind: 'changed', onlyDetails, tiles, unread });
  }

  /** Reports how many photos have their details read, if that changed since the last report. */
  #reportDetails() {
    const count = detailsCount(this.#db);
    const was = this.#counted;
    if (
      count.read !== was?.read ||
      count.photos !== was.photos ||
      count.unreadable !== was.unreadable
    ) {
      this.#counted = count;
      this.#emit({ details: count, kind: 'details' });
    }
  }

  countDetails(): void {
    keepDetailsCount(this.#db, this.#library);
    this.#reportDetails();
  }

  foldersInside(directoryId: string): string[] {
    return foldersInside(this.#db, this.#library, directoryId);
  }

  library(): number {
    return this.#library;
  }

  knownItemsIn(directoryId: string): KnownItem[] {
    return knownItemsIn(this.#db, this.#library, directoryId);
  }

  move(from: string, to: string): boolean {
    // Stored ratings are kept by path, so they move even if the rows can't.
    moveStored(this.#stored, from, to);
    const result = moveInCatalog(this.#db, this.#library, from, to);
    if (result) {
      this.#report(result);
    } else {
      this.#reportChanged(RATINGS_ONLY_CHANGE);
    }
    return result !== null;
  }

  moveRatings(from: string, to: string): void {
    moveStored(this.#stored, from, to);
    this.#reportChanged(RATINGS_ONLY_CHANGE);
  }

  rate(id: string, rating: Rating | null): void {
    rateStored(this.#stored, id, rating);
    this.#reportChanged(RATINGS_ONLY_CHANGE);
  }

  reuseDetails(photos: PhotoFile[]): string[] {
    return photos.length > 0 ? this.#writeAndReport([{ kind: 'reuseDetails', photos }]).toRead : [];
  }

  skip(items: number[]): void {
    skip(this.#details, items);
  }

  useOrders(orders: ViewOrder[]): void {
    this.#views = updateQueuedViews(this.#views, orders);
  }

  photosToRead(limit: number): UnreadPhoto[] {
    return nextUnread(this.#db, this.#library, { limit, queue: this.#details, views: this.#views });
  }

  listWholeTree(): string {
    return wholeTreeListingText(this.#db, this.#library);
  }

  write(writes: CatalogWrite[]): void {
    if (writes.length > 0) {
      this.#writeAndReport(writes);
    }
  }
}
