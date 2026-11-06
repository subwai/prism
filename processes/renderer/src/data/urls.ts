import type { SortOrder, ViewMode } from '#data/entries';
import { photoFilter } from '#data/filters';

/**
 * The view of a folder in `mode`. It keeps how the current view sorts, from `search`, and
 * leaves behind what belonged to the folder it leaves: its search, preview and slideshow.
 */
export function folderURL(mode: ViewMode, directoryId: string, search = '') {
  const params = new URLSearchParams(search);
  params.set('folder', directoryId);
  for (const name of ['q', 'preview', 'cover', 'slideshow']) {
    params.delete(name);
  }
  return `/library/${mode}?${params}`;
}

const SORT_ORDERS = new Set<string>(['taken', 'created', 'modified', 'size'] satisfies SortOrder[]);

export function sortOrder(params: URLSearchParams): SortOrder {
  const value = params.get('sort') ?? '';
  return SORT_ORDERS.has(value) ? (value as SortOrder) : 'name';
}

/**
 * What a gallery's scan reads of each entry, as far as the view's order and filters need it:
 * sorting by date taken or filtering by camera reads photos' EXIF details.
 */
export function scanDetail(params: URLSearchParams): { metadata: boolean; exif: boolean } {
  const sort = sortOrder(params);
  const exif = sort === 'taken' || photoFilter(params) !== null;
  return { exif, metadata: exif || sort !== 'name' };
}
