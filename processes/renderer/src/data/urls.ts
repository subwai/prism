import type { SortOrder, ViewMode } from '#data/entries';
import { needsExif, photoFilter, SUGGESTING } from '#data/filters';
import type { ViewSpec } from '@prism/shared';

/**
 * The view of a folder in `mode`. It keeps how the current view sorts, from `search`, and
 * leaves behind what belonged to the folder it leaves: its search, preview and slideshow.
 */
export function folderURL(mode: ViewMode, directoryId: string, search = '') {
  const params = new URLSearchParams(search);
  params.set('folder', directoryId);
  for (const name of ['q', SUGGESTING, 'preview', 'cover', 'slideshow']) {
    params.delete(name);
  }
  return `/library/${mode}?${params}`;
}

const SORT_ORDERS = new Set<string>(['taken', 'created', 'modified', 'size'] satisfies SortOrder[]);

export function sortOrder(params: URLSearchParams): SortOrder {
  const value = params.get('sort') ?? '';
  return SORT_ORDERS.has(value) ? (value as SortOrder) : 'name';
}

// What each mode shows: the grid folders too, the filmstrip photos and videos, the reader photos.
const SHOWN: Record<ViewMode, ViewSpec['show']> = {
  filmstrip: 'media',
  grid: 'all',
  reader: 'images',
};

/**
 * What the view of `directoryId` in `mode` shows, as the URL's search, sort and filters say.
 * The filmstrip shows everything inside the folder, however deep.
 */
export function viewSpec(params: URLSearchParams, mode: ViewMode, directoryId: string): ViewSpec {
  return {
    descending: params.get('order') === 'desc',
    directoryId,
    filter: photoFilter(params),
    recursive: mode === 'filmstrip',
    search: params.get('q') ?? '',
    show: SHOWN[mode],
    sort: sortOrder(params),
    suggesting: params.has(SUGGESTING),
  };
}

/** A folder's own entries by name, as its preview shows them. */
export function folderSpec(directoryId: string): ViewSpec {
  return {
    descending: false,
    directoryId,
    filter: { camera: [], format: [], lens: [], tag: [] },
    recursive: false,
    search: '',
    show: 'all',
    sort: 'name',
    suggesting: false,
  };
}

/** The photos and videos of what `spec` shows, as a photo preview browses them. */
export function mediaOf(spec: ViewSpec): ViewSpec {
  return { ...spec, show: spec.show === 'all' ? 'media' : spec.show };
}

/**
 * Whether a view's order or filters need photos' EXIF details, which the worker then reads
 * at full speed, and the status bar says how many it has still to read.
 */
export function needsDetails({ sort, filter }: ViewSpec): boolean {
  return sort === 'taken' || needsExif(filter);
}
