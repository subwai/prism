import { subfolders } from '#data/subfolders';
import type { FolderTrail } from '#data/trails';
import { useLibrary } from '#hooks/use-library';
import type { FolderListing, PhotoEntry, PhotoFolder } from '@prism/shared';
import { type QueryObserverResult, useQueries } from '@tanstack/react-query';
import { useRef, useState } from 'react';

/** A folder in the sidebar's tree. */
export interface TreeRow {
  entry: PhotoEntry;
  /** The row of the folder holding it; `null` for the root. */
  parent: TreeRow | null;
  /** How many folders down from the root, which is 0. */
  depth: number;
  /** Where it falls among its siblings, counting from 1, since only some rows are rendered. */
  position: number;
  siblings: number;
}

/** The folders from the root down to the row's own. */
export function trailOf(row: TreeRow): PhotoFolder[] {
  const trail: PhotoFolder[] = [];
  for (let current: TreeRow | null = row; current; current = current.parent) {
    trail.push(current.entry);
  }
  return trail.toReversed();
}

/** Whether the row is inside a folder `folders` picks. */
export function inside(row: TreeRow, folders: (id: string) => boolean) {
  for (let current = row.parent; current; current = current.parent) {
    if (folders(current.entry.id)) {
      return true;
    }
  }
  return false;
}

/** The root and, under each folder `listings` has, its subfolders. */
function rowsOf(root: PhotoFolder, listings: Map<string, FolderListing | undefined>) {
  const rows: TreeRow[] = [];
  function append(entry: PhotoEntry, parent: TreeRow | null, position: number, siblings: number) {
    const row: TreeRow = {
      depth: parent ? parent.depth + 1 : 0,
      entry,
      parent,
      position,
      siblings,
    };
    rows.push(row);
    if (listings.has(entry.id)) {
      const children = subfolders(listings.get(entry.id));
      for (const [index, child] of children.entries()) {
        append(child, row, index + 1, children.length);
      }
    }
  }
  append({ ...root, kind: 'directory', parentId: root.id }, null, 1, 1);
  const indexes = new Map(rows.map((row, index) => [row.entry.id, index]));
  /** Where the row for `id` is, or -1 if it is not shown. */
  const indexOf = (id: string | undefined) => (id === undefined ? -1 : (indexes.get(id) ?? -1));
  return { indexOf, rows };
}

/**
 * Which folders the tree has open, and the rows that makes: the root and, under each open
 * folder, its subfolders as far as they have been read. A folder is open once opened, until
 * closed; one holding the current folder, at the end of `trail`, starts open. The tree reads
 * every open folder's listing, which keeps those cached for as long as they are open, and
 * rebuilds its rows only when one changes.
 */
export function useTreeRows(root: PhotoFolder, trail: FolderTrail) {
  const library = useLibrary();
  // Folders opened or closed by hand; the rest are open if they hold the current folder.
  const [opened, setOpened] = useState(() => new Map([[root.id, true]]));
  // Bumped by collapsing, so an expansion still reading folders stops opening them.
  const expansion = useRef(0);
  const ancestors = new Set(trail.slice(0, -1).map((folder) => folder.id));
  const expanded = (id: string) => opened.get(id) ?? ancestors.has(id);
  const open = [...new Set([...opened.keys(), ...ancestors])].filter((id) => expanded(id));
  const listings = useQueries({
    combine: (results: QueryObserverResult<FolderListing>[]) =>
      new Map(open.map((id, index) => [id, results[index]?.data])),
    queries: open.map((id) => library.directoryQuery(id)),
  });
  const { rows, indexOf } = rowsOf(root, listings);
  const anyExpanded = rows.some((row) => row.depth > 0 && expanded(row.entry.id));

  function setExpanded(id: string, isOpen: boolean) {
    setOpened((previous) => new Map(previous).set(id, isOpen));
  }
  /** Back to the initial tree: only the root open, including the current folder's ancestors. */
  function collapseAll() {
    expansion.current += 1;
    const closed = [...opened.keys(), ...ancestors].map((id): [string, boolean] => [id, false]);
    setOpened(new Map([...closed, [root.id, true]]));
  }
  /** Opens the whole tree level by level, as each level's folders are read. */
  async function expandAll(onLevel: (ids: string[]) => void) {
    expansion.current += 1;
    const run = expansion.current;
    let level = [root.id];
    while (level.length > 0) {
      const states = await Promise.all(level.map((id) => library.directory(id)));
      if (run !== expansion.current) {
        return;
      }
      level = states.flatMap((state) => subfolders(state).map((folder) => folder.id));
      const next = level;
      onLevel(next);
      setOpened(
        (previous) => new Map([...previous, ...next.map((id): [string, boolean] => [id, true])]),
      );
    }
  }
  return { anyExpanded, collapseAll, expandAll, expanded, indexOf, rows, setExpanded };
}
