import type { TrashGroup, TrashRow } from '@prism/shared';

/** The rows by the folder they are in, in the order they came. */
export function groupsOf(rows: TrashRow[]): TrashGroup[] {
  const byFolder = Map.groupBy(rows, (row) => row.entry.parentId);
  return [...byFolder].map(([folderId, folderRows]) => ({ folderId, rows: folderRows }));
}

/** The entries of `entries` by the folder each is in, keeping their order. */
export function childrenOf<Entry extends { parentId: string }>(
  entries: Entry[],
): Map<string, Entry[]> {
  return Map.groupBy(entries, (entry) => entry.parentId);
}
