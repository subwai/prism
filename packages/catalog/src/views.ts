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

export type CatalogViews = ReturnType<typeof createCatalogViews>;

function orderKey({ scope, spec }: View) {
  return JSON.stringify([scope.directoryId, scope.recursive, spec.sort]);
}

/**
 * The views windows have open of one library: each an order of entry numbers, made again as
 * the catalog changes. Every scope's order in each sort is read once a generation and shared;
 * a view narrows it to what it shows (see `narrowing.ts`).
 */
export function createCatalogViews({ db, library, generation }: ViewSources) {
  const views = new Map<string, View>();
  const orders = new Map<string, { generation: number; order: ScopeOrder }>();
  let sequence = 0;

  function versionOf(view: View): ViewVersion {
    return {
      count: view.items.length,
      unread: countUnread(db, library, view.scope),
      version: view.version,
    };
  }

  /** Every entry of the view's scope in its sort's order, ascending, read once a generation. */
  function orderOf(view: View) {
    const key = orderKey(view);
    const cached = orders.get(key);
    if (cached?.generation === generation()) {
      return cached.order;
    }
    const order = scopeOrder(db, library, view.scope, view.spec.sort);
    orders.set(key, { generation: generation(), order });
    return order;
  }

  /** Makes the view's order as the catalog is now, as a new version. */
  function make(view: View): ViewVersion {
    const items = narrow(
      orderOf(view),
      shownKinds(view.spec),
      filterSets(db, library, view.scope, view.spec),
      view.spec.descending,
    );
    if (view.version > 0) {
      view.previous = { items: view.items, version: view.version };
    }
    sequence += 1;
    view.version = sequence;
    view.items = items;
    view.generation = generation();
    view.cursor = 0;
    return versionOf(view);
  }

  /** The view's order as of `version`, which may be the one before its current one. */
  function itemsAt(viewId: string, version: number) {
    const view = views.get(viewId);
    if (view?.version === version) {
      return { items: view.items, view };
    }
    return view?.previous?.version === version ? { items: view.previous.items, view } : null;
  }

  return {
    /** The views' orders, most recently used first. */
    byUse(): ViewOrder[] {
      return [...views.values()].toSorted((left, right) => right.usedAt - left.usedAt);
    },

    close(viewId: string): void {
      views.delete(viewId);
      const wanted = new Set([...views.values()].map((view) => orderKey(view)));
      for (const key of orders.keys()) {
        if (!wanted.has(key)) {
          orders.delete(key);
        }
      }
    },

    /** What the view's scope holds of each value to filter by, whatever else narrows it. */
    facets(viewId: string): ViewFacets | null {
      const view = views.get(viewId);
      return view ? facetsOf(db, library, view.scope) : null;
    },

    /** Where the entry `entryId` is in the view as of `version`: -1 if it is not there. */
    indexOf(viewId: string, version: number, entryId: string): number {
      const found = itemsAt(viewId, version);
      const item = found ? itemOf(db, library, entryId) : undefined;
      return found && item !== undefined ? found.items.indexOf(item) : -1;
    },

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
      views.set(viewId, view);
      return make(view);
    },

    /** Makes the view's order again, if the catalog changed since; `null` if it is closed. */
    refresh(viewId: string): ViewVersion | null {
      const view = views.get(viewId);
      if (!view) {
        return null;
      }
      return view.generation === generation() ? versionOf(view) : make(view);
    },

    /** The view's entries from `start`, as of `version`; `null` once that version has gone. */
    rows(viewId: string, version: number, start: number, count: number): PhotoEntry[] | null {
      const found = itemsAt(viewId, version);
      if (!found) {
        return null;
      }
      const shown = [...found.items.subarray(start, start + count)];
      found.view.shown = shown;
      found.view.usedAt = performance.now();
      return entries(db, shown);
    },

    /** The views whose order the catalog may have changed since it was made. */
    stale(): string[] {
      return [...views]
        .filter(([, view]) => view.generation !== generation())
        .map(([viewId]) => viewId);
    },
  };
}
