import type { CatalogConnections } from '#connections';
import { entriesIn, subfoldersOf } from '#data/contents';
import { type CatalogDatabase, catalogDatabase } from '#data/database';
import type { StoredSummary } from '#data/folder-summaries';
import { entries, known, type KnownItem } from '#data/items';
import { folderSkeleton } from '#folder-skeleton';
import { tileOf, withSummaries } from '#folder-summaries';
import { type StoredRatings, withStoredRatings } from '#stored-ratings';
import { type MakeOrder, ViewQueue } from '#view-queue';
import { CatalogViews, type ViewOrder, viewSources, type ViewVersion } from '#views';
import type {
  FolderSkeleton,
  PhotoEntry,
  TrashChoices,
  TrashFiles,
  TrashPlan,
  ViewFacets,
  ViewSpec,
} from '@prism/shared';

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
  openView: (viewId: string, spec: ViewSpec) => Promise<ViewVersion>;
  /** Makes a view again now if the catalog changed under it, as a read of it ends. */
  refreshView: (viewId: string) => Promise<ViewVersion | null>;
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
 * answers. It keeps the open views, and has `make` make them again as it hears of writes (see
 * `ViewQueue`), so its reads never wait for a view being made either. A read sees what the
 * writer had committed as it ran; it sees a write whose caller has heard back, which the writer
 * tells of first. Its methods are what its thread answers, so what it keeps to itself is private.
 */
export class CatalogReader implements CatalogReaderAPI {
  readonly #db: CatalogDatabase;
  readonly #stored: StoredRatings;
  readonly #library: number;
  readonly #emit: (event: ReaderEvent) => void;
  readonly #views: CatalogViews;
  readonly #queue: ViewQueue;

  constructor(
    connections: CatalogConnections,
    root: string,
    library: number,
    emit: (event: ReaderEvent) => void,
    make: MakeOrder,
  ) {
    this.#db = catalogDatabase(connections.index);
    this.#stored = { db: catalogDatabase(connections.ratings), root };
    this.#library = library;
    this.#emit = emit;
    this.#views = new CatalogViews(viewSources(connections, root, library));
    this.#queue = new ViewQueue(this.#views, make, (viewId, version) => {
      this.#tellOrders();
      this.#emit({ view: { ...version, viewId } });
    });
  }

  /** Tells the writer's details queue of the views' orders as they are now. */
  #tellOrders() {
    this.#emit({ orders: this.#views.byUse() });
  }

  changed(): void {
    this.#queue.changed();
  }

  /** Closes every view, so nothing more is made. */
  close(): void {
    this.#queue.stop();
    for (const { viewId } of this.#views.byUse()) {
      this.#views.close(viewId);
      this.#queue.forget(viewId);
    }
  }

  closeView(viewId: string): void {
    this.#views.close(viewId);
    this.#queue.forget(viewId);
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

  async openView(viewId: string, spec: ViewSpec): Promise<ViewVersion> {
    this.#views.open(viewId, spec);
    const version = await this.#queue.want(viewId).catch((error: unknown) => {
      // Never opened, so no one will close it.
      this.closeView(viewId);
      throw error;
    });
    if (!version) {
      throw new Error('The view is closed.');
    }
    return version;
  }

  refreshView(viewId: string): Promise<ViewVersion | null> {
    return this.#queue.want(viewId);
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
