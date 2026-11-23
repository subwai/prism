import { entriesFromListing } from '#data/tree/tree-listing-entries';
import type { FolderSummary, PhotoEntry, TreeListing } from '@prism/shared';

/** What the sidebar's tree shows: the folders the catalog knows, and which the tree has open. */
export interface TreeState {
  /** Each folder's subfolders, by name, under its ID. A folder with none known has no entry. */
  children: ReadonlyMap<string, readonly PhotoEntry[]>;
  /**
   * Folders opened (`true`) or closed by hand. The rest are open if they hold the current folder.
   */
  opened: ReadonlyMap<string, boolean>;
  /** The tile of the library's own folder, which no folder holds. None until the catalog is read. */
  root?: FolderSummary;
}

const NONE: readonly PhotoEntry[] = [];

export const EMPTY_TREE: TreeState = { children: new Map(), opened: new Map() };

/** The subfolders of `id` the tree knows, by name. */
export function subfoldersIn(state: TreeState, id: string): readonly PhotoEntry[] {
  return state.children.get(id) ?? NONE;
}

/** `state` with every folder taken from `listing`, which lists the whole tree. */
export function withWholeTree(state: TreeState, listing: TreeListing): TreeState {
  return { ...state, ...entriesFromListing(listing) };
}

/**
 * `state` with the subfolders of each of `parentIds` replaced by those in `listing`. Folders that
 * are no longer there are removed with everything the tree knew inside them. The library folder's
 * tile is replaced too, as every listing has it.
 */
export function withSubfolders(
  state: TreeState,
  parentIds: Iterable<string>,
  listing: TreeListing,
): TreeState {
  const { children: found, root } = entriesFromListing(listing);
  const children = new Map(state.children);
  function removeWithContents(id: string) {
    for (const folder of children.get(id) ?? NONE) {
      removeWithContents(folder.id);
    }
    children.delete(id);
  }
  for (const parentId of parentIds) {
    const now = found.get(parentId) ?? [];
    const ids = new Set(now.map((folder) => folder.id));
    for (const folder of children.get(parentId) ?? NONE) {
      if (!ids.has(folder.id)) {
        removeWithContents(folder.id);
      }
    }
    if (now.length > 0) {
      children.set(parentId, now);
    } else {
      children.delete(parentId);
    }
  }
  return { ...state, children, root };
}

/**
 * `state` with the folders in `listing`, whose tiles changed, put in place of the ones with the
 * same IDs, and the library folder's tile replaced. Folders the tree does not know yet are left
 * out: they arrive with their parent's subfolders.
 */
export function withChangedTiles(state: TreeState, listing: TreeListing): TreeState {
  const { children: found, root } = entriesFromListing(listing);
  const children = new Map(state.children);
  for (const [parentId, now] of found) {
    const siblings = children.get(parentId);
    if (siblings) {
      const changed = new Map(now.map((folder) => [folder.id, folder]));
      children.set(
        parentId,
        siblings.map((folder) => changed.get(folder.id) ?? folder),
      );
    }
  }
  return { ...state, children, root };
}

/**
 * The folders the tree knows inside `rootId` that have subfolders of their own: the root's own
 * first, then down a level at a time, the order "expand all" opens them in.
 */
export function foldersWithSubfolders(state: TreeState, rootId: string): string[] {
  return foldersInside(state, rootId).filter((id) => state.children.has(id));
}

/** The folders the tree knows inside `id`, however deep: its own first, then down a level at a time. */
export function foldersInside(state: TreeState, id: string): string[] {
  const found: string[] = [];
  let level = [id];
  while (level.length > 0) {
    level = level.flatMap((parentId) => subfoldersIn(state, parentId).map((folder) => folder.id));
    found.push(...level);
  }
  return found;
}
