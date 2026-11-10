import { type PhotoFile, pruneExifCache } from '#cached-details';
import { entriesIn, subfoldersOf } from '#data/contents';
import { type CatalogDatabase, catalogDatabase } from '#data/database';
import type { UnreadPhoto } from '#data/details';
import { isIndexed } from '#data/indexed-folders';
import { entries, foldersInside, known, type KnownItem, listing } from '#data/items';
import { registerLibrary } from '#data/libraries';
import { detailsQueue, markReadable, markUnreadable, nextUnread } from '#details-queue';
import { connectIndex } from '#photo-index';
import { pruneCatalog } from '#pruning';
import { connectRatings } from '#ratings-file';
import { moveStored, rateStored, type StoredRatings, withStoredRatings } from '#stored-ratings';
import { firstCovers, summaryOf } from '#summaries';
import { CatalogViews, type ViewVersion } from '#views';
import { type CatalogWrite, writeCatalog, type Written } from '#writes';
import type { FolderSummary, PhotoEntry, Rating, ViewFacets, ViewSpec } from '@prism/shared';
import type { DatabaseSync } from 'node:sqlite';

// A view is made again at most this often while the catalog changes under it, or twice as
// long as making it took, whichever is longer, so a large one never keeps the thread busy.
const MIN_REFRESH_MS = 500;

/** The files a catalog keeps: the photo index, a cache, and the ratings, which are not. */
export interface CatalogFiles {
  index: string;
  ratings: string;
}

/** What the catalog's thread answers. */
export interface CatalogAPI {
  write: (writes: CatalogWrite[]) => void;
  isIndexed: (directoryId: string) => boolean;
  foldersInside: (directoryId: string) => string[];
  listing: (directoryId: string) => KnownItem[];
  /** The entries directly inside `directoryId`, folders first, then by name. */
  entriesIn: (directoryId: string) => PhotoEntry[];
  /** The folders directly inside each of `directoryIds`, in turn, by name. */
  subfolders: (directoryIds: string[]) => string[];
  summary: (directoryId: string) => FolderSummary;
  /** The covers of the first of `directoryIds` with photos or videos of its own. */
  firstCovers: (directoryIds: string[]) => PhotoEntry[];
  known: (ids: string[]) => KnownItem[];
  openView: (viewId: string, spec: ViewSpec) => ViewVersion;
  /** Makes a view again now if the catalog changed under it, as a read of it ends. */
  refreshView: (viewId: string) => ViewVersion | null;
  viewRows: (viewId: string, version: number, start: number, count: number) => PhotoEntry[] | null;
  viewIndexOf: (viewId: string, version: number, entryId: string) => number | null;
  viewFacets: (viewId: string) => ViewFacets | null;
  closeView: (viewId: string) => void;
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
}

/** What the catalog's thread says unasked: a view has a new version. */
export interface CatalogEvent {
  view: ViewVersion & { viewId: string };
}

/**
 * The catalog of the library at `root`, on a thread of its own: SQLite answers synchronously,
 * and a view of a large library takes long enough to make that the worker's own thread, which
 * answers thumbnails, must not wait for it. Writes and reads arrive in order, so a read sees
 * every write sent before it. Views are made again after writes, no more often than they can be.
 * Its methods are what the thread answers, so what it keeps to itself is private.
 */
export class CatalogHost implements CatalogAPI {
  readonly #database: DatabaseSync;
  readonly #db: CatalogDatabase;
  readonly #ratingsDatabase: DatabaseSync;
  readonly #stored: StoredRatings;
  readonly #library: number;
  readonly #emit: (event: CatalogEvent) => void;
  /** Bumped by every write, which tells views whose order may have changed. */
  #generation = 0;
  readonly #views: CatalogViews;
  readonly #details = detailsQueue();
  /** When each view was last made, and how long that took. */
  readonly #timings = new Map<string, { at: number; took: number }>();
  #timer: NodeJS.Timeout | undefined;

  constructor(files: CatalogFiles, root: string, emit: (event: CatalogEvent) => void) {
    this.#database = connectIndex(files.index);
    // Reading a library writes many rows; checkpointing less often spares most of the syncs.
    // `connectIndex` sets how long it waits for another worker's write.
    this.#database.exec('PRAGMA wal_autocheckpoint = 10000; PRAGMA cache_size = -65536;');
    this.#db = catalogDatabase(this.#database);
    this.#ratingsDatabase = connectRatings(files.ratings);
    this.#stored = { db: catalogDatabase(this.#ratingsDatabase), root };
    pruneCatalog(this.#db, root);
    pruneExifCache(this.#db);
    this.#library = registerLibrary(this.#db, root);
    this.#emit = emit;
    this.#views = new CatalogViews({
      db: this.#db,
      generation: () => this.#generation,
      library: this.#library,
      stored: this.#stored,
    });
  }

  /** Makes a view, noting how long it took, which says how soon it may be made again. */
  #timed<Result>(viewId: string, make: () => Result): Result {
    const started = performance.now();
    const result = make();
    const at = performance.now();
    this.#timings.set(viewId, { at, took: at - started });
    return result;
  }

  /** When a view may be made again. */
  #dueAt(viewId: string) {
    const timing = this.#timings.get(viewId);
    return timing ? timing.at + Math.max(MIN_REFRESH_MS, timing.took * 2) : 0;
  }

  #refreshDue() {
    for (const viewId of this.#views.stale()) {
      if (this.#dueAt(viewId) > performance.now()) {
        continue;
      }
      const version = this.#timed(viewId, () => this.#views.refresh(viewId));
      if (version) {
        this.#emit({ view: { ...version, viewId } });
      }
    }
  }

  /** Makes the views the catalog changed under again once they are due, telling of each. */
  #schedule() {
    const stale = this.#views.stale();
    if (this.#timer || stale.length === 0) {
      return;
    }
    const due = Math.min(...stale.map((viewId) => this.#dueAt(viewId)));
    this.#timer = setTimeout(
      () => {
        this.#timer = undefined;
        this.#refreshDue();
        this.#schedule();
      },
      Math.max(0, due - performance.now()),
    );
  }

  #apply(writes: CatalogWrite[]): Written {
    const written = writeCatalog(this.#db, this.#library, writes);
    this.#generation += 1;
    // Details of a file that changed since they were read are read again once the catalog
    // lists it as it is now.
    markUnreadable(this.#details, written.missed);
    markReadable(this.#details, written.unread);
    this.#schedule();
    return written;
  }

  close(): void {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#database.close();
    this.#ratingsDatabase.close();
  }

  /** Has views made again, as a change of ratings may change what they show. */
  #ratingsChanged() {
    this.#generation += 1;
    this.#schedule();
  }

  closeView(viewId: string): void {
    this.#views.close(viewId);
    this.#timings.delete(viewId);
  }

  entriesIn(directoryId: string): PhotoEntry[] {
    return withStoredRatings(
      this.#stored,
      entries(this.#db, entriesIn(this.#db, this.#library, directoryId)),
    );
  }

  firstCovers(directoryIds: string[]): PhotoEntry[] {
    return withStoredRatings(this.#stored, firstCovers(this.#db, this.#library, directoryIds));
  }

  foldersInside(directoryId: string): string[] {
    return foldersInside(this.#db, this.#library, directoryId);
  }

  isIndexed(directoryId: string): boolean {
    return isIndexed(this.#db, this.#library, directoryId);
  }

  known(ids: string[]): KnownItem[] {
    return known(this.#db, this.#library, ids);
  }

  listing(directoryId: string): KnownItem[] {
    return listing(this.#db, this.#library, directoryId);
  }

  markUnreadable(items: number[]): void {
    markUnreadable(this.#details, items);
  }

  moveRatings(from: string, to: string): void {
    moveStored(this.#stored, from, to);
    this.#ratingsChanged();
  }

  openView(viewId: string, spec: ViewSpec): ViewVersion {
    return this.#timed(viewId, () => this.#views.open(viewId, spec));
  }

  rate(id: string, rating: Rating | null): void {
    rateStored(this.#stored, id, rating);
    this.#ratingsChanged();
  }

  recall(photos: PhotoFile[]): string[] {
    return photos.length > 0 ? this.#apply([{ recalled: photos }]).uncached : [];
  }

  refreshView(viewId: string): ViewVersion | null {
    return this.#timed(viewId, () => this.#views.refresh(viewId));
  }

  subfolders(directoryIds: string[]): string[] {
    return directoryIds.flatMap((id) => subfoldersOf(this.#db, this.#library, id));
  }

  summary(directoryId: string): FolderSummary {
    const summary = summaryOf(this.#db, this.#library, directoryId);
    return { ...summary, covers: withStoredRatings(this.#stored, summary.covers) };
  }

  viewFacets(viewId: string): ViewFacets | null {
    return this.#views.facets(viewId);
  }

  viewIndexOf(viewId: string, version: number, entryId: string): number | null {
    return this.#views.indexOf(viewId, version, entryId);
  }

  viewRows(viewId: string, version: number, start: number, count: number): PhotoEntry[] | null {
    return this.#views.rows(viewId, version, start, count);
  }

  wanted(limit: number): UnreadPhoto[] {
    return nextUnread(this.#db, this.#library, this.#details, limit, this.#views.byUse());
  }

  write(writes: CatalogWrite[]): void {
    if (writes.length > 0) {
      this.#apply(writes);
    }
  }
}
