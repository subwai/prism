import type { ReadDetails } from '#cached-details';
import { type CatalogDatabase, catalogDatabase } from '#data/database';
import { registerLibrary } from '#data/libraries';
import { connectIndex } from '#photo-index';
import { type CatalogViews, createCatalogViews } from '#views';
import { type CatalogWrite, writeCatalog, type Written } from '#writes';
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

/** One library's catalog, as the catalog's host keeps it. */
export interface TestCatalog {
  db: CatalogDatabase;
  library: number;
  /** Writes to the catalog, bumping its generation as the host does. */
  write: (writes: CatalogWrite[]) => Written;
  /** A new set of views of the catalog. */
  views: () => CatalogViews;
}

export function openCatalog(root = '/library', database = openDatabase()): TestCatalog {
  const db = catalogDatabase(database);
  const library = registerLibrary(db, root);
  let generation = 0;
  return {
    db,
    library,
    views: () => createCatalogViews({ db, generation: () => generation, library }),
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

/** What was read from the photo at `id`, a file at `/library/<id>` with no place on disk. */
export function details(id: string, exif: PhotoExif, size = 50, modifiedMs = 1000): ReadDetails {
  return { exif, file: path.join('/library', id), id, identity: null, modifiedMs, size };
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
  const { version } = views.open('view', spec(overrides));
  return shown(views, 'view', version);
}
