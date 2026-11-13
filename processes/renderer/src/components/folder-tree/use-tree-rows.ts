import { treeRows } from '#components/folder-tree/tree-rows';
import { foldersWithSubfolders, subfoldersIn } from '#data/folder-skeleton';
import type { FolderTrail } from '#data/trails';
import { useLibrary } from '#hooks/use-library';
import type { PhotoFolder } from '@prism/shared';
import { useSyncExternalStore } from 'react';

/**
 * Which folders the tree has open, and the rows that makes, from the library's folders the
 * window holds, so opening and closing folders, or all of them, asks nothing of another process.
 * The session keeps what was opened and closed, so the next one opens them again.
 */
export function useTreeRows(root: PhotoFolder, trail: FolderTrail) {
  const { tree } = useLibrary();
  const state = useSyncExternalStore(tree.subscribe, tree.getSnapshot);
  const { rows, indexOf, expanded } = treeRows(state, root, trail);
  const ancestors = [root.id, ...trail.slice(0, -1).map((folder) => folder.id)];
  const anyExpanded = rows.some((row) => row.depth > 0 && expanded(row.entry.id));

  /** Whether a folder is known to have folders inside. */
  function expandable(id: string) {
    return subfoldersIn(state, id).length > 0;
  }
  /** Whether the catalog has read a folder to the end, so the tree knows all its subfolders. */
  function listed(id: string) {
    return state.listed.has(id);
  }
  function setExpanded(id: string, isOpen: boolean) {
    tree.setOpened(new Map(tree.getSnapshot().opened).set(id, isOpen));
  }
  /** Back to the initial tree: only the root open, including the current folder's ancestors. */
  function collapseAll() {
    const closed = [...state.opened.keys(), ...ancestors].map((id): [string, boolean] => [
      id,
      false,
    ]);
    tree.setOpened(new Map([...closed, [root.id, true]]));
  }
  /** Opens every folder the tree knows to have folders inside, telling `onOpen` which. */
  function expandAll(onOpen: (ids: string[]) => void) {
    const ids = foldersWithSubfolders(state, root.id);
    onOpen(ids);
    const { opened } = tree.getSnapshot();
    tree.setOpened(new Map([...opened, ...ids.map((id): [string, boolean] => [id, true])]));
  }
  return {
    anyExpanded,
    collapseAll,
    expandAll,
    expandable,
    expanded,
    indexOf,
    listed,
    rows,
    setExpanded,
  };
}
