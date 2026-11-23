import { type CatalogDatabase, catalogDatabase } from '#database/catalog-database';
import type { CatalogConnections } from '#database/connections';
import { detailsCount, keepDetailsCount } from '#repositories/details-count';
import { foldersInside } from '#repositories/folders';
import type { UnreadPhoto } from '#repositories/items/details';
import { type KnownItem, knownItemsIn } from '#repositories/items/entries';
import { registerLibrary } from '#repositories/libraries';
import {
  detailsQueue,
  nextUnread,
  type QueuedView,
  skip,
  stopSkipping,
  stopSkippingAll,
  updateQueuedViews,
} from '#services/details/details-queue';
import { forgetStatus } from '#services/details/forget-details';
import { type PhotoFile, pruneRemovedDetails } from '#services/details/reusable-details';
import { moveStored, rateStored, type StoredRatings } from '#services/ratings/stored-ratings';
import { storeTreeListing, wholeTreeListingText } from '#services/tree/tree-listing';
import type { ViewOrder } from '#services/views/catalog-views';
import { moveInCatalog } from '#services/writes/moves';
import { pruneCatalog } from '#services/writes/pruning';
import { type CatalogWrite, writeCatalog } from '#services/writes/write-catalog';
import type { TreeChanges, WriteResult } from '#services/writes/write-result';
import { RepeatBetweenTasks } from '#threads/repeat-between-tasks';
import type { CatalogWriterAPI, WriterEvent } from '#threads/writer-api';
import type { DetailsProgress, Rating } from '@prism/shared';

// How long writes that change the tree must stop before the writer stores its listing again. The
// first read of a library changes the tree every quarter of a second, so this way it is stored
// once, not on every write.
const TREE_LISTING_QUIET_MS = 5000;
// What a rating change reports. It changes no row of the index, but views that filter or sort by
// rating may still show something different.
const RATINGS_ONLY_CHANGE = { folders: [], onlyDetails: false, tiles: [] };

/**
 * The catalog's writer for the library at `root`. It applies the indexer's and details reader's writes
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
  /** A forget of photos' details, a batch at a time, with the writes queued meanwhile between. */
  readonly #forget = new RepeatBetweenTasks(() => this.#forgetNextBatch());
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
    // A forget the app quit during carries on where it stopped.
    if (forgetStatus(this.#db)) {
      this.#forget.start();
    }
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

  /** Stops the pending tree listing store and forget batch, as the catalog closes. */
  close(): void {
    clearTimeout(this.#storeTimer);
    this.#forget.stop();
  }

  forgetDetails(): void {
    this.#writeAndReport([{ kind: 'startForgettingDetails' }]);
    this.#forget.start();
  }

  /**
   * Forgets one batch, and reports how far the forget has got, or that it is done. Returns
   * whether there is more to forget.
   */
  #forgetNextBatch(): boolean {
    this.#writeAndReport([{ kind: 'forgetDetailsBatch' }]);
    const progress = forgetStatus(this.#db);
    if (progress) {
      this.#emit({ kind: 'forgetting', progress });
      return true;
    }
    // Every photo is to be read again, so none stays left out for the session.
    stopSkippingAll(this.#details);
    this.#emit({ kind: 'detailsForgotten' });
    return false;
  }

  #writeAndReport(writes: CatalogWrite[]): WriteResult {
    const result = writeCatalog(this.#db, this.#library, writes);
    this.#report(result);
    return result;
  }

  /** Reports what a write changed, which views and the tree may need to show. */
  #report(result: WriteResult) {
    // A photo whose file changed since its details were read is skipped until a read lists the
    // file as it is now. That read marks it unread again, which ends the skip.
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
