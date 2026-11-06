import type { SortOrder, ViewMode } from '#data/entries';

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

/** What a gallery's scan reads of each entry, as far as the view's order needs it. */
export function scanDetail(params: URLSearchParams): { metadata: boolean; exif: boolean } {
  const sort = sortOrder(params);
  return { exif: sort === 'taken', metadata: sort !== 'name' };
}
