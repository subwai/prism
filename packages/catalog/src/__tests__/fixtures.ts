import { type CatalogDatabase, catalogDatabase } from '#database/catalog-database';
import { connectIndex } from '#database/photo-index';
import { connectRatings } from '#database/ratings';
import type { ReadDetails } from '#details/reusable-details';
import type { StoredRatings } from '#ratings/stored-ratings';
import { registerLibrary } from '#repositories/libraries';
import { CatalogViews, type ViewSources, type ViewVersion } from '#views/catalog-views';
import { ViewOrders } from '#views/view-orders';
import { type CatalogWrite, writeCatalog } from '#writes/write-catalog';
import type { WriteResult } from '#writes/write-result';
import {
  emptyFilter,
  type PhotoEntry,
  type PhotoExif,
  type PhotoFilter,
  type PhotoMetadata,
  type ViewSpec,
} from '@prism/shared';
import path from 'node:path';
import { onTestFinished } from 'vitest';

export function openDatabase() {
  const database = connectIndex(':memory:');
  onTestFinished(() => database.close());
  return database;
}

/** Views of a catalog that make their orders at once, on this thread, at its generation. */
class TestViews extends CatalogViews {
  readonly #orders: ViewOrders;

  constructor(
    sources: ViewSources,
    private readonly generation: () => number,
  ) {
    super(sources);
    this.#orders = new ViewOrders(sources);
  }

  /** Opens a view and makes its first version. */
  openNow(viewId: string, asked: ViewSpec): ViewVersion {
    this.open(viewId, asked);
    return this.refreshNow(viewId) as ViewVersion;
  }

  /** Makes the view's order again, if the catalog changed since; `null` if it is closed. */
  refreshNow(viewId: string): ViewVersion | null {
    const asked = this.specOf(viewId);
    if (!asked || !this.stale(this.generation()).includes(viewId)) {
      return this.versionOf(viewId);
    }
    return this.addVersion(
      viewId,
      this.#orders.make(asked, this.generation()),
      this.#orders.unread(asked),
    );
  }

  /** What the view's scope holds of each value to filter by; `undefined` if it is closed. */
  facets(viewId: string) {
    const asked = this.specOf(viewId);
    return asked && this.#orders.facets(asked);
  }
}

/** One library's catalog, as the catalog's host keeps it. */
export interface TestCatalog {
  db: CatalogDatabase;
  library: number;
  /** Writes to the catalog, bumping its generation as the host does. */
  write: (writes: CatalogWrite[]) => WriteResult;
  /** The ratings of entries that keep none in a file of their own. */
  stored: StoredRatings;
  /** A new set of views of the catalog. */
  views: () => TestViews;
  /** The catalog's generation, which every write bumps, as the reader counts them. */
  generation: () => number;
  /** Bumps the generation, as the host does when ratings change. */
  touch: () => void;
}

export function openCatalog(root = '/library', database = openDatabase()): TestCatalog {
  const db = catalogDatabase(database);
  const library = registerLibrary(db, root);
  const ratings = connectRatings(':memory:');
  onTestFinished(() => ratings.close());
  const stored = { db: catalogDatabase(ratings), root };
  let generation = 0;
  return {
    db,
    generation: () => generation,
    library,
    stored,
    touch() {
      generation += 1;
    },
    views: () => new TestViews({ db, library, stored }, () => generation),
    write(writes) {
      generation += 1;
      return writeCatalog(db, library, writes);
    },
  };
}

/** A file's metadata, as a read lists it. */
export function changedAt(modifiedMs: number, size = 50): PhotoMetadata {
  return { accessedMs: 0, createdMs: 0, modifiedMs, size };
}

/** An entry at `id`: a photo if its name has an extension, a folder if not. */
export function entry(id: string, overrides: Partial<PhotoEntry> = {}): PhotoEntry {
  const name = path.basename(id);
  const kind = overrides.kind ?? (path.extname(name) ? 'image' : 'directory');
  return {
    id,
    kind,
    name,
    parentId: path.dirname(id),
    ...(kind === 'directory' ? {} : { metadata: changedAt(1000) }),
    ...overrides,
  };
}

/** What was read from the photo at `id`. */
export function details(id: string, exif: PhotoExif, size = 50, modifiedMs = 1000): ReadDetails {
  return { exif, id, modifiedMs, size };
}

export function filtered(filter: Partial<PhotoFilter>): Pick<ViewSpec, 'filter'> {
  return { filter: { ...emptyFilter(), ...filter } };
}

export function spec(overrides: Partial<ViewSpec> = {}): ViewSpec {
  return {
    descending: false,
    directoryId: '.',
    recursive: false,
    search: '',
    show: 'all',
    sort: 'name',
    suggesting: false,
    ...filtered({}),
    ...overrides,
  };
}

/** The IDs a view shows as of `version`. */
export function shown(views: CatalogViews, viewId: string, version: number) {
  return (views.rows(viewId, version, 0, 1024) ?? []).map((row) => row.id);
}

/** The IDs a new view of `catalog` shows. */
export function openView(catalog: TestCatalog, overrides: Partial<ViewSpec> = {}) {
  const views = catalog.views();
  const { version } = views.openNow('view', spec(overrides));
  return shown(views, 'view', version);
}
