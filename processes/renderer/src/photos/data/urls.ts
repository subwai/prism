import type { SortOrder, ViewMode } from '#photos/data/entries';

/**
 * The view of a folder in `mode`. It keeps how the current view sorts, from `search`, and
 * leaves behind what belonged to the folder it leaves: its search, preview and slideshow.
 */
export function folderURL(mode: ViewMode, directoryId: string, search = '') {
  const params = new URLSearchParams(search);
  params.set('folder', directoryId);
  for (const name of ['q', 'preview', 'slideshow']) {
    params.delete(name);
  }
  return `/library/${mode}?${params}`;
}

export function sortOrder(params: URLSearchParams): SortOrder {
  const value = params.get('sort');
  return value === 'created' || value === 'modified' || value === 'size' ? value : 'name';
}
