import { subfoldersIn, type TreeState } from '#data/folder-skeleton';
import { holdsFolders } from '#data/folder-tiles';
import type { FolderTrail } from '#data/trails';
import type { PhotoEntry, PhotoFolder } from '@prism/shared';

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

/** The folders that start open: the root and those holding the current folder, at the end of `trail`. */
export function ancestorsOf(root: PhotoFolder, trail: FolderTrail): Set<string> {
  return new Set([root.id, ...trail.slice(0, -1).map((folder) => folder.id)]);
}

/**
 * Whether the tree shows a folder open: as opened or closed by hand, or else if it is the root
 * or holds the current folder, at the end of `trail`.
 */
function expandedIn(opened: ReadonlyMap<string, boolean>, root: PhotoFolder, trail: FolderTrail) {
  const ancestors = ancestorsOf(root, trail);
  return (id: string) => opened.get(id) ?? ancestors.has(id);
}

/**
 * `opened` with `changes` made to it, keeping only what differs from how a folder starts: those
 * opened, and those of `ancestors` closed. Any other closed folder starts closed anyway, so the
 * tree forgets it, and what it remembers grows with what was opened, not with the library.
 */
export function withOpened(
  opened: ReadonlyMap<string, boolean>,
  changes: Iterable<[id: string, open: boolean]>,
  ancestors: ReadonlySet<string>,
): Map<string, boolean> {
  const next = new Map<string, boolean>();
  for (const entries of [opened, changes]) {
    for (const [id, open] of entries) {
      if (open || ancestors.has(id)) {
        next.set(id, open);
      } else {
        next.delete(id);
      }
    }
  }
  return next;
}

/**
 * The tree's rows: the root and, under each open folder, its subfolders as far as the catalog
 * knows them. A folder is open once opened, until closed; one holding the current folder, at
 * the end of `trail`, starts open.
 */
export function treeRows(state: TreeState, root: PhotoFolder, trail: FolderTrail) {
  const expanded = expandedIn(state.opened, root, trail);
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
    if (expanded(entry.id)) {
      const children = subfoldersIn(state, entry.id);
      for (const [index, child] of children.entries()) {
        append(child, row, index + 1, children.length);
      }
    }
  }
  append({ ...root, kind: 'directory', parentId: root.id, summary: state.root }, null, 1, 1);
  const indexes = new Map(rows.map((row, index) => [row.entry.id, index]));
  /** Where the row for `id` is, or -1 if it is not shown. */
  const indexOf = (id: string | undefined) => (id === undefined ? -1 : (indexes.get(id) ?? -1));
  /**
   * Whether the row's folder can open or close: as its tile says once the catalog has read it,
   * and until then if the tree knows folders inside it, or it is open, so it can be closed.
   */
  const expandable = (row: TreeRow) =>
    holdsFolders(
      row.entry.summary,
      expanded(row.entry.id) || subfoldersIn(state, row.entry.id).length > 0,
    );
  return { expandable, expanded, indexOf, rows };
}
