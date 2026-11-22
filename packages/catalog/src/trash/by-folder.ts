import type { TrashGroup, TrashRow } from '@prism/shared';

/** The rows by the folder they are in, in the order they came. */
export function groupsOf(rows: TrashRow[]): TrashGroup[] {
  const groups = new Map<string, TrashGroup>();
  for (const row of rows) {
    const { parentId } = row.entry;
    const group = groups.get(parentId) ?? { folderId: parentId, rows: [] };
    group.rows.push(row);
    groups.set(parentId, group);
  }
  return [...groups.values()];
}

/** The entries of `entries` by the folder each is in, keeping their order. */
export function childrenOf<Entry extends { parentId: string }>(
  entries: Entry[],
): Map<string, Entry[]> {
  const children = new Map<string, Entry[]>();
  for (const entry of entries) {
    const siblings = children.get(entry.parentId) ?? [];
    siblings.push(entry);
    children.set(entry.parentId, siblings);
  }
  return children;
}
