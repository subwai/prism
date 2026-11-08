import type { ScopeOrder } from '#photos/catalog-queries';
import { KIND_CODES } from '#photos/catalog-schema';
import type { CatalogStore, Scope } from '#photos/catalog-store';
import {
  FILTER_FIELDS,
  type FilterChoice,
  FORMATS,
  type PhotoEntry,
  type PhotoFilter,
  type ViewFacets,
  type ViewSpec,
} from '@prism/shared';

/** A view's order as of one version, and how many photos it holds still lack details. */
export interface ViewVersion {
  version: number;
  count: number;
  unread: number;
}

/** What the enricher needs of a view to pick the photos to read next. */
export interface ViewOrder {
  items: Int32Array;
  /** The rows the window last asked for, whose photos are read first. */
  shown: number[];
  /** How far the enricher has looked through `items` for photos without details. */
  cursor: number;
  usedAt: number;
}

interface View extends ViewOrder {
  spec: ViewSpec;
  scope: Scope;
  version: number;
  generation: number;
  /** The version before, kept so rows asked for just as it changed still answer. */
  previous: { version: number; items: Int32Array } | null;
}

type Kind = PhotoEntry['kind'];

// The kinds each view shows.
const SHOWN: Record<ViewSpec['show'], Kind[]> = {
  all: ['directory', 'image', 'video'],
  images: ['image'],
  media: ['image', 'video'],
};
const FORMAT_KINDS = new Map(
  Object.entries(FORMATS).map(([kind, format]) => [format, kind as Kind]),
);

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function narrows(filter: PhotoFilter) {
  return FILTER_FIELDS.some((field) => filter[field].length > 0);
}

/** A set of entry numbers as a byte per number, as views test thousands at a time. */
function setOf(items: Iterable<number>, size: number) {
  const set = new Uint8Array(size + 1);
  for (const item of items) {
    set[item] = 1;
  }
  return set;
}

/** The kinds a view shows, as a flag per kind code. */
function shownKinds({ show, filter }: ViewSpec) {
  let kinds = SHOWN[show];
  // Folders have none of the values filters choose.
  if (narrows(filter)) {
    kinds = kinds.filter((kind) => kind !== 'directory');
  }
  if (filter.format.length > 0) {
    const formats = new Set(filter.format.map((format) => FORMAT_KINDS.get(format)));
    kinds = kinds.filter((kind) => formats.has(kind));
  }
  const shown = new Uint8Array(Object.keys(KIND_CODES).length);
  for (const kind of kinds) {
    shown[KIND_CODES[kind]] = 1;
  }
  return shown;
}

function sorted(choices: FilterChoice[]) {
  return choices.toSorted((left, right) => collator.compare(left.value, right.value));
}

function orderKey({ scope, spec }: View) {
  return JSON.stringify([scope.directoryId, scope.recursive, spec.sort]);
}

/**
 * The views windows have open of one library: each an order of entry numbers, made again as
 * the catalog changes. Every scope's order in each sort is read once a generation and shared;
 * a view narrows it to the kinds it shows and to its search and filters, which each come from
 * an index of their own, rather than asking SQLite for every combination.
 */
export class CatalogViews {
  private readonly views = new Map<string, View>();
  private readonly orders = new Map<string, { generation: number; order: ScopeOrder }>();
  private sequence = 0;

  constructor(private readonly store: CatalogStore) {}

  /** The views' orders, most recently used first. */
  byUse(): ViewOrder[] {
    return [...this.views.values()].toSorted((left, right) => right.usedAt - left.usedAt);
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
    this.views.set(viewId, view);
    return this.make(view);
  }

  close(viewId: string): void {
    this.views.delete(viewId);
    const wanted = new Set([...this.views.values()].map((view) => orderKey(view)));
    for (const key of this.orders.keys()) {
      if (!wanted.has(key)) {
        this.orders.delete(key);
      }
    }
  }

  /** The views whose order the catalog may have changed since it was made. */
  stale(): string[] {
    return [...this.views]
      .filter(([, view]) => view.generation !== this.store.generation)
      .map(([viewId]) => viewId);
  }

  /** Makes the view's order again, if the catalog changed since; `null` if it is closed. */
  refresh(viewId: string): ViewVersion | null {
    const view = this.views.get(viewId);
    if (!view) {
      return null;
    }
    return view.generation === this.store.generation ? this.versionOf(view) : this.make(view);
  }

  private versionOf(view: View): ViewVersion {
    return {
      count: view.items.length,
      unread: this.store.queries.unread(view.scope),
      version: view.version,
    };
  }

  /** Every entry of the view's scope in its sort's order, ascending. */
  private order(view: View) {
    const key = orderKey(view);
    const cached = this.orders.get(key);
    if (cached?.generation === this.store.generation) {
      return cached.order;
    }
    const order = this.store.queries.order(view.scope, view.spec.sort);
    this.orders.set(key, { generation: this.store.generation, order });
    return order;
  }

  /** The sets of entries the view's search and filters let through, each one needed. */
  private sets({ scope, spec }: View) {
    const { queries } = this.store;
    const size = queries.maxItem();
    const sets: Uint8Array[] = [];
    for (const field of ['camera', 'lens'] as const) {
      if (spec.filter[field].length > 0) {
        sets.push(setOf(queries.having(scope, field, spec.filter[field]), size));
      }
    }
    if (spec.filter.tag.length > 0) {
      sets.push(setOf(queries.tagged(spec.filter.tag), size));
    }
    const search = spec.search.trim().toLocaleLowerCase();
    if (search) {
      const tags = queries.tags().filter((tag) => tag.toLocaleLowerCase().includes(search));
      const tagged = tags.length > 0 ? queries.tagged(tags) : [];
      sets.push(setOf([...queries.named(scope, search), ...tagged], size));
    }
    return sets;
  }

  /** Makes the view's order as the catalog is now, as a new version. */
  private make(view: View): ViewVersion {
    const shown = shownKinds(view.spec);
    const { items, kinds } = this.order(view);
    const sets = this.sets(view);
    const made = new Int32Array(items.length);
    let count = 0,
      folders = 0;
    for (const [index, item] of items.entries()) {
      const kind = kinds[index] ?? KIND_CODES.file;
      if (shown[kind] !== 1 || sets.some((set) => set[item] !== 1)) {
        continue;
      }
      made[count] = item;
      count += 1;
      if (kind === KIND_CODES.directory) {
        folders += 1;
      }
    }
    const result = made.subarray(0, count);
    // Folders come first either way, so a descending view reverses each group on its own.
    if (view.spec.descending) {
      result.subarray(0, folders).reverse();
      result.subarray(folders).reverse();
    }
    if (view.version > 0) {
      view.previous = { items: view.items, version: view.version };
    }
    this.sequence += 1;
    view.version = this.sequence;
    view.items = result;
    view.generation = this.store.generation;
    view.cursor = 0;
    return this.versionOf(view);
  }

  private itemsAt(viewId: string, version: number) {
    const view = this.views.get(viewId);
    if (!view) {
      return null;
    }
    if (view.version === version) {
      return { items: view.items, view };
    }
    return view.previous?.version === version ? { items: view.previous.items, view } : null;
  }

  /** The view's entries from `start`, as of `version`; `null` once that version has gone. */
  rows(viewId: string, version: number, start: number, count: number): PhotoEntry[] | null {
    const found = this.itemsAt(viewId, version);
    if (!found) {
      return null;
    }
    const shown = [...found.items.subarray(start, start + count)];
    found.view.shown = shown;
    found.view.usedAt = performance.now();
    return this.store.queries.rows(shown);
  }

  /** Where the entry `entryId` is in the view as of `version`: -1 if it is not there. */
  indexOf(viewId: string, version: number, entryId: string): number {
    const found = this.itemsAt(viewId, version);
    const item = found ? this.store.itemOf(entryId) : undefined;
    return found && item !== undefined ? found.items.indexOf(item) : -1;
  }

  /** What the view's scope holds of each value to filter by, whatever else it is narrowed to. */
  facets(viewId: string): ViewFacets | null {
    const view = this.views.get(viewId);
    if (!view) {
      return null;
    }
    const counts = this.store.queries.counts(view.scope);
    return {
      fields: {
        camera: sorted(counts.camera),
        format: sorted(
          counts.formats.flatMap(({ kind, count }) => {
            const value = FORMATS[kind];
            return value ? [{ count, value }] : [];
          }),
        ),
        lens: sorted(counts.lens),
        tag: sorted(counts.tag),
      },
      unread: counts.unread,
    };
  }
}
