import { countUnread } from '#repositories/entries/details';
import { type ScopeOrder, scopeOrder } from '#repositories/entries/scope-orders';
import {
  applyFilters,
  countUnsupported,
  filterSets,
  shownKinds,
} from '#services/views/apply-filters';
import type { ViewSources } from '#services/views/catalog-views';
import { facetsOf } from '#services/views/facets';
import type { ViewFacets, ViewSpec } from '@prism/shared';

// A scope is the folders a view or query covers: one folder, or it and every folder inside it.
// Facets are the values a view can be filtered by, such as its cameras, with how many photos have
// each.

/** A view's order as the catalog was at one of the reader's generations. */
export interface MadeOrder {
  /** In memory every thread shares, so handing it to the reader copies none of it. */
  entries: Int32Array;
  /** The reader's generation it was asked for at, which its writes were all in by. */
  generation: number;
  /** Files of its scope that no view shows, whatever its search and filters. */
  unsupported: number;
}

/** What the thread that makes views' orders answers. */
export interface ViewOrdersAPI {
  make: (spec: ViewSpec, generation: number) => MadeOrder;
  /** How many photos the view's scope holds still lack details. */
  unread: (spec: ViewSpec) => number;
  /** What the view's scope holds of each value to filter by, whatever else filters it. */
  facets: (spec: ViewSpec) => ViewFacets['fields'];
}

function scopeOf(spec: ViewSpec) {
  return { directoryId: spec.directoryId, recursive: spec.recursive };
}

/** `entries` in memory another thread can read too. */
function copyToSharedMemory(entries: Int32Array) {
  const copy = new Int32Array(new SharedArrayBuffer(entries.byteLength));
  copy.set(entries);
  return copy;
}

/**
 * Makes views' orders, counts their photos still to read and their values to filter by, on a
 * thread and connection of its own, so the reader answers the window while a view of a million
 * entries is made, or a whole library's search suggestions are counted. Every scope's
 * order in each sort is read once a generation and shared; a view filters it to what it shows
 * (see `apply-filters.ts`).
 */
export class ViewOrders implements ViewOrdersAPI {
  /** The scopes' orders read at `#generation`, which no later generation may use. */
  readonly #orders = new Map<string, ScopeOrder>();
  #generation = -1;

  constructor(private readonly sources: ViewSources) {}

  make(spec: ViewSpec, generation: number): MadeOrder {
    const { db, library, stored } = this.sources;
    if (generation !== this.#generation) {
      this.#orders.clear();
      this.#generation = generation;
    }
    const scope = scopeOf(spec);
    const key = JSON.stringify([scope.directoryId, scope.recursive, spec.sort]);
    let order = this.#orders.get(key);
    if (!order) {
      order = scopeOrder(db, library, scope, spec.sort);
      this.#orders.set(key, order);
    }
    const entries = applyFilters(
      order,
      shownKinds(spec),
      filterSets(db, library, scope, spec, stored),
      spec.descending,
    );
    return {
      entries: copyToSharedMemory(entries),
      generation,
      unsupported: countUnsupported(order),
    };
  }

  unread(spec: ViewSpec): number {
    const { db, library } = this.sources;
    return countUnread(db, library, scopeOf(spec));
  }

  facets(spec: ViewSpec): ViewFacets['fields'] {
    const { db, library, stored } = this.sources;
    return facetsOf(db, library, scopeOf(spec), stored);
  }
}
