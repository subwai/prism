import { type CatalogDatabase, catalogDatabase } from '#database/catalog-database';
import type { CatalogConnections } from '#database/connections';
import { entriesInOrder, itemOf } from '#repositories/items/entries';
import type { Scope } from '#repositories/queries/scope';
import { type StoredRatings, withStoredRatings } from '#services/ratings/stored-ratings';
import { listViewTrashFiles, planViewTrash } from '#services/trash/view-trash';
import { withSummaries } from '#services/tree/read-summaries';
import { type ViewFile, viewFiles } from '#services/views/view-files';
import type { MadeOrder } from '#services/views/view-orders';
import type { PhotoEntry, TrashChoices, TrashFileList, TrashPlan, ViewSpec } from '@prism/shared';

/**
 * A view's order as of one version, how many photos it holds still lack details, and how many
 * files its scope holds that no view shows. Version 0 is a view not made yet.
 */
export interface ViewVersion {
  version: number;
  count: number;
  unread: number;
  unsupported: number;
}

/**
 * What the details queue needs of a view to pick the photos to read next. The reader keeps the
 * views and tells the writer, which keeps the queue, of each as it changes.
 */
export interface ViewOrder {
  viewId: string;
  version: number;
  /** In memory both threads share, so telling the writer of a view copies none of it. */
  items: Int32Array;
  /** The rows the window last asked for, whose photos are read first. */
  shown: number[];
  usedAt: number;
}

/** Entries of a view from `start`, as `CatalogViews.files` reads them; `whole` if all of them. */
export interface ViewFileRange {
  files: ViewFile[];
  start: number;
  whole: boolean;
}

interface View extends MadeOrder {
  spec: ViewSpec;
  scope: Scope;
  version: number;
  /** How many photos its scope holds still lack details. */
  unread: number;
  /** The rows the window last asked for. */
  shown: number[];
  usedAt: number;
  /** The version before, kept so rows asked for just as it changed still answer. */
  previous: { version: number; items: Int32Array } | null;
}

/** The library the views are of. */
export interface ViewSources {
  db: CatalogDatabase;
  library: number;
  /** The ratings of entries that keep none in a file of their own. */
  stored: StoredRatings;
}

/** What views of the library numbered `library` at `root` read through `connections`. */
export function viewSources(
  connections: CatalogConnections,
  root: string,
  library: number,
): ViewSources {
  return {
    db: catalogDatabase(connections.index),
    library,
    stored: { db: catalogDatabase(connections.ratings), root },
  };
}

function versionOf(view: View): ViewVersion {
  return {
    count: view.items.length,
    unread: view.unread,
    unsupported: view.unsupported,
    version: view.version,
  };
}

/**
 * The views windows have open of one library: each an order of entry numbers, which
 * `ViewOrders` makes again as the catalog changes and `use` makes its next version.
 */
export class CatalogViews {
  readonly #views = new Map<string, View>();
  #sequence = 0;

  constructor(private readonly sources: ViewSources) {}

  /** The view's order as of `version`, which may be the one before its current one. */
  #itemsAt(viewId: string, version: number) {
    const view = this.#views.get(viewId);
    if (view?.version === version) {
      return { items: view.items, view };
    }
    return view?.previous?.version === version ? { items: view.previous.items, view } : null;
  }

  /** The views' orders, most recently used first. */
  byUse(): ViewOrder[] {
    return [...this.#views]
      .map(([viewId, { items, shown, usedAt, version }]) => ({
        items,
        shown,
        usedAt,
        version,
        viewId,
      }))
      .toSorted((left, right) => right.usedAt - left.usedAt);
  }

  close(viewId: string): void {
    this.#views.delete(viewId);
  }

  /**
   * Where the entry `entryId` is in the view as of `version`: -1 if it is not there, and
   * `null` if that version has gone, as the view keeps only its last two.
   */
  indexOf(viewId: string, version: number, entryId: string): number | null {
    const found = this.#itemsAt(viewId, version);
    if (!found) {
      return null;
    }
    const item = itemOf(this.sources.db, this.sources.library, entryId);
    return item === undefined ? -1 : found.items.indexOf(item);
  }

  /** Opens a view of what `spec` asks for, holding nothing until its order is made. */
  open(viewId: string, spec: ViewSpec): void {
    this.#views.set(viewId, {
      generation: -1,
      items: new Int32Array(),
      previous: null,
      scope: { directoryId: spec.directoryId, recursive: spec.recursive },
      shown: [],
      spec,
      unread: 0,
      unsupported: 0,
      usedAt: performance.now(),
      version: 0,
    });
  }

  /** What the view shows; `undefined` if it is closed. */
  specOf(viewId: string): ViewSpec | undefined {
    return this.#views.get(viewId)?.spec;
  }

  /** The reader's generation the view's order was made at; `undefined` if it is closed. */
  generationOf(viewId: string): number | undefined {
    return this.#views.get(viewId)?.generation;
  }

  /**
   * The view's order as it is, at `generation`, for a view whose order the writes since cannot
   * have changed, as they only brought photos' details; `null` if it is closed.
   */
  currentOrder(viewId: string, generation: number): MadeOrder | null {
    const view = this.#views.get(viewId);
    return view ? { generation, items: view.items, unsupported: view.unsupported } : null;
  }

  /** The view's current version; `null` if it is closed. */
  versionOf(viewId: string): ViewVersion | null {
    const view = this.#views.get(viewId);
    return view ? versionOf(view) : null;
  }

  /**
   * Makes `made` the view's next version, with `unread` photos still to read, keeping the one
   * before; `null` if it is closed.
   */
  addVersion(viewId: string, made: MadeOrder, unread: number): ViewVersion | null {
    const view = this.#views.get(viewId);
    if (!view) {
      return null;
    }
    if (view.version > 0) {
      view.previous = { items: view.items, version: view.version };
    }
    this.#sequence += 1;
    view.version = this.#sequence;
    view.items = made.items;
    view.generation = made.generation;
    view.unread = unread;
    view.unsupported = made.unsupported;
    return versionOf(view);
  }

  /** The view's entries from `start`, as of `version`; `null` once that version has gone. */
  rows(viewId: string, version: number, start: number, count: number): PhotoEntry[] | null {
    const found = this.#itemsAt(viewId, version);
    if (!found) {
      return null;
    }
    const shown = [...found.items.subarray(start, start + count)];
    found.view.shown = shown;
    found.view.usedAt = performance.now();
    const { db, library, stored } = this.sources;
    return withSummaries(db, library, stored, withStoredRatings(stored, entriesInOrder(db, shown)));
  }

  /**
   * The entries of the view as it is now, as the catalog last listed their files, with folders'
   * covers, for the worker to make thumbnails ahead of the window's scroll: every one if it holds
   * fewer than `limit` rows, or else only those from `start` up to `end`; `null` if it is closed.
   * Unlike `rows`, it says nothing of what the window shows.
   */
  files(viewId: string, start: number, end: number, limit: number): ViewFileRange | null {
    const view = this.#views.get(viewId);
    if (!view) {
      return null;
    }
    const whole = view.items.length < limit;
    const from = whole ? 0 : Math.max(0, start);
    const numbers = whole ? view.items : view.items.subarray(from, Math.max(from, end));
    return {
      files: viewFiles(this.sources.db, this.sources.library, [...numbers]),
      start: from,
      whole,
    };
  }

  /**
   * What moving the entries the view shows as of `version` to the Trash would move, with
   * everything inside the folders among them; `null` once that version has gone. The view is of
   * everything inside a folder, folders included, so they match as they do in any view.
   */
  trashPlan(viewId: string, version: number, choices: TrashChoices): TrashPlan | null {
    const found = this.#itemsAt(viewId, version);
    if (!found) {
      return null;
    }
    return planViewTrash(this.sources, found.view.scope.directoryId, found.items, choices);
  }

  /** Every entry the plan `trashPlan` makes would move, one by one; `null` as it is. */
  trashFiles(viewId: string, version: number, choices: TrashChoices): TrashFileList | null {
    const found = this.#itemsAt(viewId, version);
    if (!found) {
      return null;
    }
    return listViewTrashFiles(this.sources, found.view.scope.directoryId, found.items, choices);
  }

  /** The views whose order the catalog may have changed since it was made, at `generation`. */
  stale(generation: number): string[] {
    return [...this.#views]
      .filter(([, view]) => view.generation !== generation)
      .map(([viewId]) => viewId);
  }
}
