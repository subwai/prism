import { type PhotoFile, pruneExifCache } from '#photos/catalog/cached-details';
import { entriesIn, subfoldersOf } from '#photos/catalog/data/contents';
import { catalogDatabase } from '#photos/catalog/data/database';
import type { UnreadPhoto } from '#photos/catalog/data/details';
import { isIndexed } from '#photos/catalog/data/indexed-folders';
import { entries, foldersInside, known, type KnownItem, listing } from '#photos/catalog/data/items';
import { registerLibrary } from '#photos/catalog/data/libraries';
import { createDetailsQueue } from '#photos/catalog/details-queue';
import { connectIndex } from '#photos/catalog/photo-index';
import { pruneCatalog } from '#photos/catalog/pruning';
import { firstCovers, summaryOf } from '#photos/catalog/summaries';
import { createCatalogViews, type ViewVersion } from '#photos/catalog/views';
import { type CatalogWrite, writeCatalog, type Written } from '#photos/catalog/writes';
import type { FolderSummary, PhotoEntry, ViewFacets, ViewSpec } from '@prism/shared';

// A view is made again at most this often while the catalog changes under it, or twice as
// long as making it took, whichever is longer, so a large one never keeps the thread busy.
const MIN_REFRESH_MS = 500;

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
  viewIndexOf: (viewId: string, version: number, entryId: string) => number;
  viewFacets: (viewId: string) => ViewFacets | null;
  closeView: (viewId: string) => void;
  wanted: (limit: number) => UnreadPhoto[];
  /** Stores the details the cache has of `photos`; returns the IDs of those it has none of. */
  recall: (photos: PhotoFile[]) => string[];
  markUnreadable: (items: number[]) => void;
}

/** What the catalog's thread says unasked: a view has a new version. */
export interface CatalogEvent {
  view: ViewVersion & { viewId: string };
}

export type CatalogHost = CatalogAPI & { close: () => void };

/**
 * The catalog of the library at `root`, on a thread of its own: SQLite answers synchronously,
 * and a view of a large library takes long enough to make that the worker's own thread, which
 * answers thumbnails, must not wait for it. Writes and reads arrive in order, so a read sees
 * every write sent before it. Views are made again after writes, no more often than they can be.
 */
export function createCatalogHost(
  file: string,
  root: string,
  emit: (event: CatalogEvent) => void,
): CatalogHost {
  const database = connectIndex(file);
  // Reading a library writes many rows; checkpointing less often spares most of the syncs.
  database.exec(
    'PRAGMA wal_autocheckpoint = 10000; PRAGMA cache_size = -65536; PRAGMA busy_timeout = 5000;',
  );
  const db = catalogDatabase(database);
  pruneCatalog(db, root);
  pruneExifCache(db);
  const library = registerLibrary(db, root);
  /** Bumped by every write, which tells views whose order may have changed. */
  let generation = 0;
  const views = createCatalogViews({ db, generation: () => generation, library });
  const details = createDetailsQueue(db, library);
  /** When each view was last made, and how long that took. */
  const timings = new Map<string, { at: number; took: number }>();
  let timer: NodeJS.Timeout | undefined;

  /** Makes a view, noting how long it took, which says how soon it may be made again. */
  function timed<Result>(viewId: string, make: () => Result): Result {
    const started = performance.now();
    const result = make();
    timings.set(viewId, { at: performance.now(), took: performance.now() - started });
    return result;
  }

  /** When a view may be made again. */
  function dueAt(viewId: string) {
    const timing = timings.get(viewId);
    return timing ? timing.at + Math.max(MIN_REFRESH_MS, timing.took * 2) : 0;
  }

  function refreshDue() {
    for (const viewId of views.stale()) {
      if (dueAt(viewId) > performance.now()) {
        continue;
      }
      const version = timed(viewId, () => views.refresh(viewId));
      if (version) {
        emit({ view: { ...version, viewId } });
      }
    }
  }

  /** Makes the views the catalog changed under again once they are due, telling of each. */
  function schedule() {
    const stale = views.stale();
    if (timer || stale.length === 0) {
      return;
    }
    const due = Math.min(...stale.map((viewId) => dueAt(viewId)));
    timer = setTimeout(
      () => {
        timer = undefined;
        refreshDue();
        schedule();
      },
      Math.max(0, due - performance.now()),
    );
  }

  function write(writes: CatalogWrite[]): Written {
    const written = writeCatalog(db, library, writes);
    generation += 1;
    // Details of a file that changed since they were read are read again once the catalog
    // lists it as it is now.
    details.markUnreadable(written.missed);
    details.markReadable(written.unread);
    schedule();
    return written;
  }

  return {
    close(): void {
      clearTimeout(timer);
      timer = undefined;
      database.close();
    },
    closeView(viewId: string): void {
      views.close(viewId);
      timings.delete(viewId);
    },
    entriesIn: (directoryId) => entries(db, entriesIn(db, library, directoryId)),
    firstCovers: (directoryIds) => firstCovers(db, library, directoryIds),
    foldersInside: (directoryId) => foldersInside(db, library, directoryId),
    isIndexed: (directoryId) => isIndexed(db, library, directoryId),
    known: (ids) => known(db, library, ids),
    listing: (directoryId) => listing(db, library, directoryId),
    markUnreadable: (items) => details.markUnreadable(items),
    openView: (viewId, spec) => timed(viewId, () => views.open(viewId, spec)),
    recall: (photos) => (photos.length > 0 ? write([{ recalled: photos }]).uncached : []),
    refreshView: (viewId) => timed(viewId, () => views.refresh(viewId)),
    subfolders: (directoryIds) => directoryIds.flatMap((id) => subfoldersOf(db, library, id)),
    summary: (directoryId) => summaryOf(db, library, directoryId),
    viewFacets: (viewId) => views.facets(viewId),
    viewIndexOf: (viewId, version, entryId) => views.indexOf(viewId, version, entryId),
    viewRows: (viewId, version, start, count) => views.rows(viewId, version, start, count),
    wanted: (limit) => details.next(limit, views.byUse()),
    write(writes: CatalogWrite[]): void {
      if (writes.length > 0) {
        write(writes);
      }
    },
  };
}
