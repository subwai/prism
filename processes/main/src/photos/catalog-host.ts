import { pruneCatalog } from '#photos/catalog-schema';
import {
  CatalogStore,
  type CatalogWrite,
  type KnownItem,
  type UnreadPhoto,
} from '#photos/catalog-store';
import { CatalogViews, type ViewVersion } from '#photos/catalog-views';
import { DetailsQueue } from '#photos/details-queue';
import { connectIndex } from '#photos/photo-index';
import type { PhotoEntry, ViewFacets, ViewSpec } from '@prism/shared';
import type { DatabaseSync } from 'node:sqlite';

// A view is made again at most this often while the catalog changes under it, or twice as
// long as making it took, whichever is longer, so a large one never keeps the thread busy.
const MIN_REFRESH_MS = 500;

/** What the catalog's thread answers. */
export interface CatalogAPI {
  write: (writes: CatalogWrite[]) => void;
  isIndexed: (directoryId: string) => boolean;
  foldersInside: (directoryId: string) => string[];
  listing: (directoryId: string) => KnownItem[];
  known: (ids: string[]) => KnownItem[];
  openView: (viewId: string, spec: ViewSpec) => ViewVersion;
  /** Makes a view again now if the catalog changed under it, as a read of it ends. */
  refreshView: (viewId: string) => ViewVersion | null;
  viewRows: (viewId: string, version: number, start: number, count: number) => PhotoEntry[] | null;
  viewIndexOf: (viewId: string, version: number, entryId: string) => number;
  viewFacets: (viewId: string) => ViewFacets | null;
  closeView: (viewId: string) => void;
  wanted: (limit: number) => UnreadPhoto[];
  markUnreadable: (items: number[]) => void;
}

/** What the catalog's thread says unasked: a view has a new version. */
export interface CatalogEvent {
  view: ViewVersion & { viewId: string };
}

/**
 * The catalog of one library, on a thread of its own: SQLite answers synchronously, and a view
 * of a large library takes long enough to make that the worker's own thread, which answers
 * thumbnails, must not wait for it. Writes and reads arrive in order, so a read sees every
 * write sent before it. Views are made again after writes, no more often than they can be.
 */
export class CatalogHost implements CatalogAPI {
  private readonly database: DatabaseSync;
  private readonly store: CatalogStore;
  private readonly views: CatalogViews;
  private readonly details: DetailsQueue;
  /** When each view was last made, and how long that took. */
  private readonly timings = new Map<string, { at: number; took: number }>();
  private timer: NodeJS.Timeout | undefined;

  constructor(
    file: string,
    root: string,
    private readonly emit: (event: CatalogEvent) => void,
  ) {
    this.database = connectIndex(file);
    // Reading a library writes many rows; checkpointing less often spares most of the syncs.
    this.database.exec(
      'PRAGMA wal_autocheckpoint = 10000; PRAGMA cache_size = -65536; PRAGMA busy_timeout = 5000;',
    );
    pruneCatalog(this.database, root);
    this.store = new CatalogStore(this.database, root);
    this.views = new CatalogViews(this.store);
    this.details = new DetailsQueue(this.store.queries);
  }

  write(writes: CatalogWrite[]): void {
    const before = this.store.generation;
    const { missed, unread } = this.store.write(writes);
    // Details of a file that changed since they were read are read again once the catalog
    // lists it as it is now.
    this.details.markUnreadable(missed);
    this.details.markReadable(unread);
    if (this.store.generation !== before) {
      this.schedule();
    }
  }

  isIndexed(directoryId: string): boolean {
    return this.store.isIndexed(directoryId);
  }

  foldersInside(directoryId: string): string[] {
    return this.store.foldersInside(directoryId);
  }

  listing(directoryId: string): KnownItem[] {
    return this.store.listing(directoryId);
  }

  known(ids: string[]): KnownItem[] {
    return this.store.known(ids);
  }

  /** Makes a view, noting how long it took, which says how soon it may be made again. */
  private timed<Result>(viewId: string, make: () => Result): Result {
    const started = performance.now();
    const result = make();
    this.timings.set(viewId, { at: performance.now(), took: performance.now() - started });
    return result;
  }

  openView(viewId: string, spec: ViewSpec): ViewVersion {
    return this.timed(viewId, () => this.views.open(viewId, spec));
  }

  refreshView(viewId: string): ViewVersion | null {
    return this.timed(viewId, () => this.views.refresh(viewId));
  }

  viewRows(viewId: string, version: number, start: number, count: number): PhotoEntry[] | null {
    return this.views.rows(viewId, version, start, count);
  }

  viewIndexOf(viewId: string, version: number, entryId: string): number {
    return this.views.indexOf(viewId, version, entryId);
  }

  viewFacets(viewId: string): ViewFacets | null {
    return this.views.facets(viewId);
  }

  closeView(viewId: string): void {
    this.views.close(viewId);
    this.timings.delete(viewId);
  }

  wanted(limit: number): UnreadPhoto[] {
    return this.details.next(limit, this.views.byUse());
  }

  markUnreadable(items: number[]): void {
    this.details.markUnreadable(items);
  }

  /** When a view may be made again. */
  private dueAt(viewId: string) {
    const timing = this.timings.get(viewId);
    return timing ? timing.at + Math.max(MIN_REFRESH_MS, timing.took * 2) : 0;
  }

  /** Makes the views the catalog changed under again once they are due, telling of each. */
  private schedule() {
    if (this.timer) {
      return;
    }
    const stale = this.views.stale();
    if (stale.length === 0) {
      return;
    }
    const due = Math.min(...stale.map((viewId) => this.dueAt(viewId)));
    this.timer = setTimeout(
      () => {
        this.timer = undefined;
        this.refreshDue();
        this.schedule();
      },
      Math.max(0, due - performance.now()),
    );
  }

  private refreshDue() {
    for (const viewId of this.views.stale()) {
      if (this.dueAt(viewId) > performance.now()) {
        continue;
      }
      const version = this.timed(viewId, () => this.views.refresh(viewId));
      if (version) {
        this.emit({ view: { ...version, viewId } });
      }
    }
  }

  close(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.database.close();
  }
}
