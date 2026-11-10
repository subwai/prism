import type { CatalogDatabase } from '#data/database';
import { countUnread } from '#data/details';
import { entries, itemOf } from '#data/items';
import { type ScopeOrder, scopeOrder } from '#data/orders';
import type { Scope } from '#data/scope';
import { facetsOf } from '#facets';
import { filterSets, narrow, shownKinds } from '#narrowing';
import type { PhotoEntry, ViewFacets, ViewSpec } from '@prism/shared';

/** A view's order as of one version, and how many photos it holds still lack details. */
export interface ViewVersion {
  version: number;
  count: number;
  unread: number;
}

/** What the details queue needs of a view to pick the photos to read next. */
export interface ViewOrder {
  items: Int32Array;
  /** The rows the window last asked for, whose photos are read first. */
  shown: number[];
  /** How far the details queue has looked through `items` for photos without details. */
  cursor: number;
  usedAt: number;
}

interface View extends ViewOrder {
  spec: ViewSpec;
  scope: Scope;
  version: number;
  /** The catalog's generation the order was made at. */
  generation: number;
  /** The version before, kept so rows asked for just as it changed still answer. */
  previous: { version: number; items: Int32Array } | null;
}

/** The library the views are of, and the generation of its catalog, which every write bumps. */
export interface ViewSources {
  db: CatalogDatabase;
  library: number;
  generation: () => number;
}

function orderKey({ scope, spec }: View) {
  return JSON.stringify([scope.directoryId, scope.recursive, spec.sort]);
}

/**
 * The views windows have open of one library: each an order of entry numbers, made again as
 * the catalog changes. Every scope's order in each sort is read once a generation and shared;
 * a view narrows it to what it shows (see `narrowing.ts`). Orders no open view uses are let go.
 */
export class CatalogViews {
  readonly #views = new Map<string, View>();
  readonly #orders = new Map<string, { generation: number; order: ScopeOrder }>();
  #sequence = 0;

  constructor(private readonly sources: ViewSources) {}

  #versionOf(view: View): ViewVersion {
    const { db, library } = this.sources;
    return {
      count: view.items.length,
      unread: countUnread(db, library, view.scope),
      version: view.version,
    };
  }

  /** Every entry of the view's scope in its sort's order, ascending, read once a generation. */
  #orderOf(view: View) {
    const { db, library, generation } = this.sources;
    const key = orderKey(view);
    const cached = this.#orders.get(key);
    if (cached?.generation === generation()) {
      return cached.order;
    }
    const order = scopeOrder(db, library, view.scope, view.spec.sort);
    this.#orders.set(key, { generation: generation(), order });
    return order;
  }

  /** Makes the view's order as the catalog is now, as a new version. */
  #make(view: View): ViewVersion {
    const { db, library, generation } = this.sources;
    const items = narrow(
      this.#orderOf(view),
      shownKinds(view.spec),
      filterSets(db, library, view.scope, view.spec),
      view.spec.descending,
    );
    if (view.version > 0) {
      view.previous = { items: view.items, version: view.version };
    }
    this.#sequence += 1;
    view.version = this.#sequence;
    view.items = items;
    view.generation = generation();
    view.cursor = 0;
    return this.#versionOf(view);
  }

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
    return [...this.#views.values()].toSorted((left, right) => right.usedAt - left.usedAt);
  }

  close(viewId: string): void {
    this.#views.delete(viewId);
    const wanted = new Set([...this.#views.values()].map((view) => orderKey(view)));
    for (const key of this.#orders.keys()) {
      if (!wanted.has(key)) {
        this.#orders.delete(key);
      }
    }
  }

  /** What the view's scope holds of each value to filter by, whatever else narrows it. */
  facets(viewId: string): ViewFacets | null {
    const view = this.#views.get(viewId);
    return view ? facetsOf(this.sources.db, this.sources.library, view.scope) : null;
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

  open(viewId: string, spec: ViewSpec): ViewVersion {
    const view: View = {
      cursor: 0,
      generation: -1,
      items: new Int32Array(),
      previous: null,
      scope: { directoryId: spec.directoryId, recursive: spec.recursive },
      shown: [],
      spec,
      usedAt: performance.now(),
      version: 0,
    };
    this.#views.set(viewId, view);
    return this.#make(view);
  }

  /** Makes the view's order again, if the catalog changed since; `null` if it is closed. */
  refresh(viewId: string): ViewVersion | null {
    const view = this.#views.get(viewId);
    if (!view) {
      return null;
    }
    return view.generation === this.sources.generation() ? this.#versionOf(view) : this.#make(view);
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
    return entries(this.sources.db, shown);
  }

  /** The views whose order the catalog may have changed since it was made. */
  stale(): string[] {
    const generation = this.sources.generation();
    return [...this.#views]
      .filter(([, view]) => view.generation !== generation)
      .map(([viewId]) => viewId);
  }
}
