import type { CatalogConnections } from '#connections';
import { entriesIn, subfoldersOf } from '#data/contents';
import { type CatalogDatabase, catalogDatabase } from '#data/database';
import type { StoredSummary } from '#data/folder-summaries';
import { entries, known, type KnownItem } from '#data/items';
import { folderSkeleton } from '#folder-skeleton';
import { tileOf, withSummaries } from '#folder-summaries';
import { type StoredRatings, withStoredRatings } from '#stored-ratings';
import { CatalogViews, type ViewOrder, type ViewVersion } from '#views';
import type {
  FolderSkeleton,
  PhotoEntry,
  TrashChoices,
  TrashFiles,
  TrashPlan,
  ViewFacets,
  ViewSpec,
} from '@prism/shared';

// A view is made again at most this often while the catalog changes under it, or twice as
// long as making it took, whichever is longer, so a large one never keeps the thread busy.
const MIN_REFRESH_MS = 500;

/** What the catalog's reader answers. */
export interface CatalogReaderAPI {
  /** The entries directly inside `directoryId`, folders first, then by name. */
  entriesIn: (directoryId: string) => PhotoEntry[];
  /** The folders directly inside each of `directoryIds`, in turn, by name. */
  subfolders: (directoryIds: string[]) => string[];
  /** The tile of the folder `directoryId`, its covers by number; `null` if there is none. */
  tile: (directoryId: string) => StoredSummary | null;
  /** Every folder of the library, or those inside each of `parentIds`; see `FolderSkeleton`. */
  folderSkeleton: (parentIds?: string[]) => FolderSkeleton;
  known: (ids: string[]) => KnownItem[];
  openView: (viewId: string, spec: ViewSpec) => ViewVersion;
  /** Makes a view again now if the catalog changed under it, as a read of it ends. */
  refreshView: (viewId: string) => ViewVersion | null;
  viewRows: (viewId: string, version: number, start: number, count: number) => PhotoEntry[] | null;
  viewIndexOf: (viewId: string, version: number, entryId: string) => number | null;
  /** Every entry of a view as its file was listed; see `CatalogViews.files`. */
  viewFiles: (viewId: string, limit: number) => KnownItem[] | null;
  viewFacets: (viewId: string) => ViewFacets | null;
  /** What moving the view's entries to the Trash would move; see `CatalogViews.trashPlan`. */
  viewTrashPlan: (viewId: string, version: number, choices: TrashChoices) => TrashPlan | null;
  /** Every entry that plan would move, one by one; see `CatalogViews.trashFiles`. */
  viewTrashFiles: (viewId: string, version: number, choices: TrashChoices) => TrashFiles | null;
  closeView: (viewId: string) => void;
  /** Hears that the writer committed a write, which views may have to show. */
  changed: () => void;
}

/** The methods the reader answers, which the catalog's client sends it rather than the writer. */
export const READER_METHODS: ReadonlySet<string> = new Set<keyof CatalogReaderAPI>([
  'changed',
  'closeView',
  'entriesIn',
  'folderSkeleton',
  'known',
  'openView',
  'refreshView',
  'subfolders',
  'tile',
  'viewFacets',
  'viewFiles',
  'viewIndexOf',
  'viewRows',
  'viewTrashFiles',
  'viewTrashPlan',
]);

/**
 * What the reader says unasked: a view has a new version, or the views' orders changed, which
 * the writer's details queue follows.
 */
export type ReaderEvent = { view: ViewVersion & { viewId: string } } | { orders: ViewOrder[] };

/**
 * The reader of the catalog of the library numbered `library`, with a connection of its own, so
 * the window's reads never wait for a write, or for the indexer and enricher, which the writer
 * answers. It keeps the open views, and makes them again as it hears of writes, no more often
 * than they can be. A read sees what the writer had committed as it ran; it sees a write whose
 * caller has heard back, which the writer tells of first. Its methods are what its thread
 * answers, so what it keeps to itself is private.
 */
export class CatalogReader implements CatalogReaderAPI {
  readonly #db: CatalogDatabase;
  readonly #stored: StoredRatings;
  readonly #library: number;
  readonly #emit: (event: ReaderEvent) => void;
  /** Bumped by every write the reader hears of, which tells views whose order may have changed. */
  #generation = 0;
  readonly #views: CatalogViews;
  /** When each view was last made, and how long that took. */
  readonly #timings = new Map<string, { at: number; took: number }>();
  #timer: NodeJS.Timeout | undefined;

  constructor(
    connections: CatalogConnections,
    root: string,
    library: number,
    emit: (event: ReaderEvent) => void,
  ) {
    this.#db = catalogDatabase(connections.index);
    this.#stored = { db: catalogDatabase(connections.ratings), root };
    this.#library = library;
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
    this.#tellOrders();
    return result;
  }

  /** Tells the writer's details queue of the views' orders as they are now. */
  #tellOrders() {
    this.#emit({ orders: this.#views.byUse() });
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

  changed(): void {
    this.#generation += 1;
    this.#schedule();
  }

  close(): void {
    clearTimeout(this.#timer);
    this.#timer = undefined;
  }

  closeView(viewId: string): void {
    this.#views.close(viewId);
    this.#timings.delete(viewId);
    this.#tellOrders();
  }

  entriesIn(directoryId: string): PhotoEntry[] {
    const found = entries(this.#db, entriesIn(this.#db, this.#library, directoryId));
    return withSummaries(
      this.#db,
      this.#library,
      this.#stored,
      withStoredRatings(this.#stored, found),
    );
  }

  folderSkeleton(parentIds?: string[]): FolderSkeleton {
    return folderSkeleton(this.#db, this.#library, parentIds);
  }

  known(ids: string[]): KnownItem[] {
    return known(this.#db, this.#library, ids);
  }

  openView(viewId: string, spec: ViewSpec): ViewVersion {
    return this.#timed(viewId, () => this.#views.open(viewId, spec));
  }

  refreshView(viewId: string): ViewVersion | null {
    return this.#timed(viewId, () => this.#views.refresh(viewId));
  }

  subfolders(directoryIds: string[]): string[] {
    return directoryIds.flatMap((id) => subfoldersOf(this.#db, this.#library, id));
  }

  tile(directoryId: string): StoredSummary | null {
    return tileOf(this.#db, this.#library, directoryId);
  }

  viewFacets(viewId: string): ViewFacets | null {
    return this.#views.facets(viewId);
  }

  viewIndexOf(viewId: string, version: number, entryId: string): number | null {
    return this.#views.indexOf(viewId, version, entryId);
  }

  viewFiles(viewId: string, limit: number): KnownItem[] | null {
    return this.#views.files(viewId, limit);
  }

  viewTrashFiles(viewId: string, version: number, choices: TrashChoices): TrashFiles | null {
    return this.#views.trashFiles(viewId, version, choices);
  }

  viewTrashPlan(viewId: string, version: number, choices: TrashChoices): TrashPlan | null {
    return this.#views.trashPlan(viewId, version, choices);
  }

  viewRows(viewId: string, version: number, start: number, count: number): PhotoEntry[] | null {
    const rows = this.#views.rows(viewId, version, start, count);
    // The photos on screen are the ones the details queue reads first.
    this.#tellOrders();
    return rows;
  }
}
