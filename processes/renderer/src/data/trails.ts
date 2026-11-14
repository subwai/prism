import { foldersIn, type TreeState } from '#data/folder-skeleton';
import type { PendingEdits } from '#data/pending-edits';
import { followRenames } from '#data/renames';
import type { PhotoEntry, PhotoFolder, PhotoRoot } from '@prism/shared';

/** Folders from the library's root down to one inside it. */
export type FolderTrail = PhotoFolder[];

/** What the window knows of the library's folders: the catalog's tree, and the edits made here. */
export interface KnownFolders {
  tree: TreeState;
  edits: PendingEdits;
}

/**
 * The folder at `id` as the catalog's tree has it, or as the window knew it inside a folder
 * renamed here, until the tree has the folder holding it read under its new name.
 */
export function folderIn({ tree, edits }: KnownFolders, id: string): PhotoEntry | undefined {
  const folders = foldersIn(tree);
  const moved = edits.moved.get(id);
  return (
    folders.get(id) ?? (moved && !folders.get(moved.parentId)?.summary?.read ? moved : undefined)
  );
}

function trailTo(root: PhotoRoot, known: KnownFolders, id: string): FolderTrail | null {
  const trail: PhotoFolder[] = [];
  for (let current = id; current !== root.id;) {
    const folder = folderIn(known, current);
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
