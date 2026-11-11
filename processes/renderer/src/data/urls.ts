import type { SortOrder, ViewMode } from '#data/entries';
import { photoFilter, SUGGESTING } from '#data/filters';
import { emptyFilter, SORT_ORDERS, type ViewShow, type ViewSpec } from '@prism/shared';

/**
 * The view of a folder in `mode`. It keeps how the current view sorts, from `search`, and
 * leaves behind what belonged to the folder it leaves: its search, preview and slideshow.
 */
export function folderURL(mode: ViewMode, directoryId: string, search = '') {
  const params = new URLSearchParams(search);
  params.set('folder', directoryId);
  for (const name of ['q', SUGGESTING, 'preview', 'cover', 'slideshow', 'trash']) {
    params.delete(name);
  }
  return `/library/${mode}?${params}`;
}

function isSortOrder(value: string | null): value is SortOrder {
  return SORT_ORDERS.some((order) => order === value);
}

/** How the URL has the view sorted, by name unless it says otherwise. */
export function sortOrder(params: URLSearchParams): SortOrder {
  const value = params.get('sort');
  return isSortOrder(value) ? value : 'name';
}

// What each mode shows: the grid folders too, the filmstrip photos and videos, the reader photos.
const SHOWN: Record<ViewMode, ViewShow> = {
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
    filter: emptyFilter(),
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
