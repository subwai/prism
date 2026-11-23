import type { PendingEdits } from '#data/edits/pending-edits';
import { followRenames } from '#data/edits/renames';
import { subfoldersIn, type TreeState } from '#data/tree/tree-state';
import type { PhotoEntry, PhotoFolder, PhotoRoot } from '@prism/shared';

/** Folders from the library's root down to one inside it. */
export type FolderTrail = PhotoFolder[];

/** What the window knows of the library's folders: the catalog's tree, and the edits made here. */
export interface KnownFolders {
  tree: TreeState;
  edits: PendingEdits;
}

/**
 * The ID of the folder holding `id`, the library's folder `.` for those at the top: IDs are
 * paths from the library's folder, separated however the system separates them.
 */
export function parentIdOf(id: string): string {
  const end = Math.max(id.lastIndexOf('/'), id.lastIndexOf('\\'));
  return end === -1 ? '.' : id.slice(0, end);
}

/**
 * The folder at `id` the tree knows. It is looked up among the subfolders of its parent, not in
 * an index of every folder: rebuilding such an index each time the tree changed took as long as
 * rebuilding the tree.
 */
export function folderAt(tree: TreeState, id: string): PhotoEntry | undefined {
  return subfoldersIn(tree, parentIdOf(id)).find((folder) => folder.id === id);
}

function trailTo(root: PhotoRoot, known: KnownFolders, id: string): FolderTrail | null {
  const trail: PhotoFolder[] = [];
  for (let current = id; current !== root.id;) {
    const folder = folderAt(known.tree, current);
    // However deep, a trail passes each folder once at most.
    if (!folder || trail.includes(folder)) {
      return null;
    }
    trail.push(folder);
    current = folder.parentId;
  }
  return [root, ...trail.toReversed()];
}

/**
 * The folders from `root` down to `id`, or `null` if it is not a known folder. A folder renamed
 * in this window, or one inside it, is found under its new name.
 */
export function trailIn(root: PhotoRoot, known: KnownFolders, id: string): FolderTrail | null {
  return trailTo(root, known, followRenames(known.edits.renames, id)) ?? trailTo(root, known, id);
}

/**
 * Whether `id` is the folder `folderId` or inside it, however deep. IDs are paths from the
 * library's root, `rootId`, separated however the system separates them.
 */
export function isWithin(rootId: string, folderId: string, id: string): boolean {
  if (folderId === rootId || id === folderId) {
    return true;
  }
  const separator = id[folderId.length];
  return id.startsWith(folderId) && (separator === '/' || separator === '\\');
}
