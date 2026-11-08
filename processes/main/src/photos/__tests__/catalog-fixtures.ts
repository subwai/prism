import { CatalogStore } from '#photos/catalog-store';
import { CatalogViews } from '#photos/catalog-views';
import { connectIndex } from '#photos/photo-index';
import type { PhotoEntry, PhotoExif, PhotoFilter, PhotoMetadata, ViewSpec } from '@prism/shared';
import path from 'node:path';
import { onTestFinished } from 'vitest';

export function openDatabase() {
  const database = connectIndex(':memory:');
  onTestFinished(() => database.close());
  return database;
}

export function openStore(root = '/library', database = openDatabase()) {
  return new CatalogStore(database, root);
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

export function details(id: string, exif: PhotoExif, size = 50, modifiedMs = 1000) {
  return { exif, id, modifiedMs, size };
}

export function filtered(filter: Partial<PhotoFilter>): Pick<ViewSpec, 'filter'> {
  return { filter: { camera: [], format: [], lens: [], tag: [], ...filter } };
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

/** The IDs a new view of `store` shows. */
export function openView(store: CatalogStore, overrides: Partial<ViewSpec> = {}) {
  const views = new CatalogViews(store);
  const { version } = views.open('view', spec(overrides));
  return shown(views, 'view', version);
}
