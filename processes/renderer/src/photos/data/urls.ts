import type { SortOrder, ViewMode } from '#photos/data/entries';

export function folderURL(mode: ViewMode, directoryId: string, search = '') {
  const params = new URLSearchParams(search);
  params.set('folder', directoryId);
  params.delete('q');
  return `/library/${mode}?${params}`;
}

export function sortOrder(params: URLSearchParams): SortOrder {
  const value = params.get('sort');
  return value === 'created' || value === 'modified' || value === 'size' ? value : 'name';
}
