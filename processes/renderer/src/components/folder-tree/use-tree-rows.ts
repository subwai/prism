import { ancestorsOf, treeRows, withOpened } from '#components/folder-tree/tree-rows';
import type { FolderTrail } from '#data/tree/trails';
import { foldersWithSubfolders } from '#data/tree/tree-state';
import { useLibrary } from '#hooks/use-library';
import type { PhotoFolder } from '@prism/shared';
import { useSyncExternalStore } from 'react';

/**
 * Which folders the tree has open, and the rows that makes, from the library's folders the
 * window holds, so opening and closing folders, or all of them, asks nothing of another process.
 * The session keeps what was opened and closed, so the next one opens them again, remembering
 * only what differs from how the tree starts (`withOpened`).
 */
export function useTreeRows(root: PhotoFolder, trail: FolderTrail) {
  const { tree } = useLibrary();
  const state = useSyncExternalStore(tree.subscribe, tree.getSnapshot);
  const { rows, indexOf, expanded, expandable } = treeRows(state, root, trail);
  const ancestors = ancestorsOf(root, trail);
  const anyExpanded = rows.some((row) => row.depth > 0 && expanded(row.entry.id));

  function setExpanded(id: string, isOpen: boolean) {
    tree.setOpened(withOpened(tree.getSnapshot().opened, [[id, isOpen]], ancestors));
  }
  /** Back to the initial tree: only the root open, including the current folder's ancestors. */
  function collapseAll() {
    const closed = [...ancestors].map((id): [string, boolean] => [id, false]);
    tree.setOpened(new Map([...closed, [root.id, true]]));
  }
  /** Opens every folder the tree knows to have folders inside, and passes their IDs to `onOpen`. */
  function expandAll(onOpen: (ids: string[]) => void) {
    const ids = foldersWithSubfolders(state, root.id);
    onOpen(ids);
    const opening = ids.map((id): [string, boolean] => [id, true]);
    tree.setOpened(withOpened(tree.getSnapshot().opened, opening, ancestors));
  }
  return {
    anyExpanded,
    collapseAll,
    expandAll,
    expandable,
    expanded,
    indexOf,
    rows,
    setExpanded,
  };
}
