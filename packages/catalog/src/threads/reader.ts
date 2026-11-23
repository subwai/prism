import { type CatalogDatabase, catalogDatabase } from '#database/catalog-database';
import type { CatalogConnections } from '#database/connections';
import { catalogEntriesAt, type CatalogEntry, entriesInOrder } from '#repositories/entries/entries';
import { entriesIn, subfoldersOf } from '#repositories/entries/folder-contents';
import type { StoredSummary } from '#repositories/entries/folder-summaries';
import {
  folderReadMs,
  type FolderTimes,
  folderTimes,
  isIndexed,
} from '#repositories/indexed-folders';
import { type FullReads, fullReads } from '#repositories/libraries';
import { isWholeLibrary } from '#repositories/queries/scope';
import { type StoredRatings, withStoredRatings } from '#services/ratings/stored-ratings';
import { tileOf, withSummaries } from '#services/tree/read-summaries';
import { listFoldersById, listSubfolders, storedTreeListing } from '#services/tree/tree-listing';
import {
  CatalogViews,
  type ViewFileRange,
  type ViewOrder,
  viewSources,
  type ViewVersion,
} from '#services/views/catalog-views';
import { ViewQueue, type ViewThread } from '#services/views/view-queue';
import type { BusyChange } from '#threads/busy-change';
import type {
  PhotoEntry,
  SerializedTreeListing,
  TrashChoices,
  TrashFileList,
  TrashPlan,
  ViewFacets,
  ViewSpec,
} from '@prism/shared';

/** What the catalog's reader answers. */
export interface CatalogReaderAPI {
  /** The entries directly inside `directoryId`, folders first, then by name. */
  entriesIn: (directoryId: string) => PhotoEntry[];
  /** Whether the catalog has read `directoryId` to the end. */
  isIndexed: (directoryId: string) => boolean;
  /** How `directoryId` was when last read to the end with nothing failing; see `FolderTimes`. */
  folderTimes: (directoryId: string) => FolderTimes | null;
  /** When the last read of `directoryId` to the end with nothing failing began, if one did. */
  folderReadMs: (directoryId: string) => number | null;
  /** The walks that read every folder of the library in full; see `FullReads`. */
  fullReads: () => FullReads;
  /** The folders directly inside each of `directoryIds`, in turn, by name. */
  subfolderIds: (directoryIds: string[]) => string[];
  /** The tile of the folder `directoryId`, its covers by number; `null` if there is none. */
  tile: (directoryId: string) => StoredSummary | null;
  /** The folders inside each of `parentIds`; see `SerializedTreeListing`. */
  listSubfolders: (parentIds: string[]) => SerializedTreeListing;
  /** The folders at `folderIds`, as their tiles changed; see `SerializedTreeListing`. */
  listFoldersById: (folderIds: string[]) => SerializedTreeListing;
  /**
   * Every folder of the library, as the text of a `SerializedTreeListing`, if kept ready-made; see
   * `storedTreeListing`. Without one, the writer builds it (`listWholeTree`), so the window's reads
   * never wait behind making it.
   */
  storedTreeListing: () => string | null;
  catalogEntriesAt: (ids: string[]) => CatalogEntry[];
  openView: (viewId: string, spec: ViewSpec) => Promise<ViewVersion>;
  /** Makes a view again now if the catalog changed under it, as a read of it ends. */
  refreshView: (viewId: string) => Promise<ViewVersion | null>;
  viewRows: (viewId: string, version: number, start: number, count: number) => PhotoEntry[] | null;
  viewIndexOf: (viewId: string, version: number, entryId: string) => number | null;
  /** Entries of a view as their files were listed, with folders' covers; see `CatalogViews.files`. */
  viewFiles: (viewId: string, start: number, end: number, limit: number) => ViewFileRange | null;
  /** Facets: what the view's scope (its folders) holds of each filter value, with counts. */
  viewFacets: (viewId: string) => Promise<ViewFacets | null>;
  /** What moving the view's entries to the Trash would move; see `CatalogViews.trashPlan`. */
  viewTrashPlan: (viewId: string, version: number, choices: TrashChoices) => TrashPlan | null;
  /** Every entry that plan would move, one by one; see `CatalogViews.trashFiles`. */
  viewTrashFiles: (viewId: string, version: number, choices: TrashChoices) => TrashFileList | null;
  closeView: (viewId: string) => void;
  /**
   * Hears that the writer committed a write, which views may have to show, whether it changed
   * only photos' details, and how many of the library's photos still lack details after it,
   * once the writer has counted them.
   */
  changed: (onlyDetails: boolean, unread: number | undefined) => void;
}

/** The methods the reader answers, which the catalog's client sends it rather than the writer. */
export const READER_METHODS: ReadonlySet<string> = new Set<keyof CatalogReaderAPI>([
  'changed',
  'closeView',
  'entriesIn',
  'listSubfolders',
  'folderReadMs',
  'folderTimes',
  'listFoldersById',
  'fullReads',
  'isIndexed',
  'storedTreeListing',
  'catalogEntriesAt',
  'openView',
  'refreshView',
  'subfolderIds',
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
export type ReaderEvent =
  | { kind: 'view'; view: ViewVersion & { viewId: string } }
  | { kind: 'orders'; orders: ViewOrder[] }
  | BusyChange;

/**
 * Reads the catalog of the library numbered `library` for the window.
 *
 * - It has a connection of its own, so the window's reads never wait for a write. They never wait
 *   for the indexer's and details reader's reads either, because the writer answers those.
 * - It keeps the open views. When it learns of a write, it has the views' `thread` build them
 *   again (see `ViewQueue`), so its reads never wait for a view being built.
 * - A read sees what the writer had committed when the read ran. The writer reports each write
 *   before it answers it, so a read always sees a write whose caller has had its answer.
 *
 * Its public methods are what its thread answers, so everything else is private.
 */
export class CatalogReader implements CatalogReaderAPI {
  readonly #db: CatalogDatabase;
  readonly #stored: StoredRatings;
  readonly #library: number;
  readonly #emit: (event: ReaderEvent) => void;
  readonly #views: CatalogViews;
  readonly #queue: ViewQueue;
  readonly #thread: ViewThread;
  /**
   * How many of the library's photos still lack details, as the writer told of its last write;
   * until it tells of one after it has counted them, the views' thread counts them.
   */
  #libraryUnread: number | undefined;

  constructor(
    connections: CatalogConnections,
    root: string,
    library: number,
    emit: (event: ReaderEvent) => void,
    thread: ViewThread,
  ) {
    this.#db = catalogDatabase(connections.index);
    this.#stored = { db: catalogDatabase(connections.ratings), root };
    this.#library = library;
    this.#emit = emit;
    this.#views = new CatalogViews(viewSources(connections, root, library));
    this.#thread = thread;
    this.#queue = new ViewQueue(
      this.#views,
      {
        ...thread,
        // The writer keeps the whole library's count, which counting again takes 30–650 ms.
        unread: (spec) =>
          isWholeLibrary(spec) && this.#libraryUnread !== undefined
            ? Promise.resolve(this.#libraryUnread)
            : thread.unread(spec),
      },
      (viewId, version) => {
        this.#tellOrders();
        this.#emit({ kind: 'view', view: { ...version, viewId } });
      },
      (busy) => this.#emit({ activity: 'rebuildingViews', busy, kind: 'busy' }),
    );
  }

  /** Tells the writer's details queue of the views' orders as they are now. */
  #tellOrders() {
    this.#emit({ kind: 'orders', orders: this.#views.byUse() });
  }

  changed(onlyDetails: boolean, unread: number | undefined): void {
    this.#libraryUnread = unread;
    this.#queue.changed(onlyDetails);
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
    const found = entriesInOrder(this.#db, entriesIn(this.#db, this.#library, directoryId));
    return withSummaries(
      this.#db,
      this.#library,
      this.#stored,
      withStoredRatings(this.#stored, found),
    );
  }

  listSubfolders(parentIds: string[]): SerializedTreeListing {
    return listSubfolders(this.#db, this.#library, parentIds);
  }

  folderReadMs(directoryId: string): number | null {
    return folderReadMs(this.#db, this.#library, directoryId);
  }

  folderTimes(directoryId: string): FolderTimes | null {
    return folderTimes(this.#db, this.#library, directoryId);
  }

  listFoldersById(folderIds: string[]): SerializedTreeListing {
    return listFoldersById(this.#db, this.#library, folderIds);
  }

  fullReads(): FullReads {
    return fullReads(this.#db, this.#library);
  }

  isIndexed(directoryId: string): boolean {
    return isIndexed(this.#db, this.#library, directoryId);
  }

  storedTreeListing(): string | null {
    return storedTreeListing(this.#db, this.#library);
  }

  catalogEntriesAt(ids: string[]): CatalogEntry[] {
    return catalogEntriesAt(this.#db, this.#library, ids);
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

  subfolderIds(directoryIds: string[]): string[] {
    return directoryIds.flatMap((id) => subfoldersOf(this.#db, this.#library, id));
  }

  tile(directoryId: string): StoredSummary | null {
    return tileOf(this.#db, this.#library, directoryId);
  }

  async viewFacets(viewId: string): Promise<ViewFacets | null> {
    const spec = this.#views.specOf(viewId);
    const fields = spec && (await this.#thread.facets(spec));
    // As many still to read as the view's version says, which the window shows beside them.
    const version = this.#views.versionOf(viewId);
    return fields && version ? { fields, unread: version.unread } : null;
  }

  viewIndexOf(viewId: string, version: number, entryId: string): number | null {
    return this.#views.indexOf(viewId, version, entryId);
  }

  viewFiles(viewId: string, start: number, end: number, limit: number): ViewFileRange | null {
    return this.#views.files(viewId, start, end, limit);
  }

  viewTrashFiles(viewId: string, version: number, choices: TrashChoices): TrashFileList | null {
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
