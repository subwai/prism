import { skeletonSummary } from '#data/folder-tiles';
import {
  type FolderSkeleton,
  type FolderSummary,
  type PhotoEntry,
  type PhotosAPI,
  skeletonFromText,
} from '@prism/shared';

// Past this many folders changed at once, the tree reads every folder again rather than each.
const MAX_REREAD = 4096;

// How long the tree waits after a folder opens or closes to remember them, so opening folder
// after folder with the arrow keys sends them once, and never in the keypress's own task. The
// window sends any still waiting as it goes away (`flush`).
const REMEMBER_MS = 250;

/** What the sidebar's tree shows: the folders the catalog knows, and which the tree has open. */
export interface TreeState {
  /** Each folder's subfolders, by name, by its ID; a folder with none known has no entry. */
  children: ReadonlyMap<string, readonly PhotoEntry[]>;
  /** Folders opened, `true`, or closed by hand; the rest open if they hold the current folder. */
  opened: ReadonlyMap<string, boolean>;
  /** The tile of the library's folder, which no folder holds; none until the catalog is read. */
  root?: FolderSummary;
}

const NONE: readonly PhotoEntry[] = [];

export const EMPTY_TREE: TreeState = { children: new Map(), opened: new Map() };

/** The subfolders of `id` the tree knows, by name. */
export function subfoldersIn(state: TreeState, id: string): readonly PhotoEntry[] {
  return state.children.get(id) ?? NONE;
}

/**
 * The skeleton's folders, as entries with their tiles, under each folder holding them, in order,
 * and the library's folder's tile. The skeleton has them that way, so only the entries are made.
 */
function byParent({ folders, covers, root }: FolderSkeleton) {
  const children = new Map(
    folders.map(([parentId, subfolders]) => [
      parentId,
      subfolders.map(([id, name, tile]) => {
        const entry: PhotoEntry = { id, kind: 'directory', name, parentId };
        const summary = skeletonSummary(tile, covers);
        if (summary) {
          entry.summary = summary;
        }
        return entry;
      }),
    ]),
  );
  return { children, root: skeletonSummary(root, covers) };
}

/** `state` with every folder as `skeleton` has them. */
export function withSkeleton(state: TreeState, skeleton: FolderSkeleton): TreeState {
  return { ...state, ...byParent(skeleton) };
}

/**
 * `state` with the subfolders of each of `parentIds` replaced by those `skeleton` has, whole.
 * Folders no longer there take what the tree knew inside them along. The library's folder's tile
 * is replaced too, as every skeleton has it.
 */
export function withSubfolders(
  state: TreeState,
  parentIds: Iterable<string>,
  skeleton: FolderSkeleton,
): TreeState {
  const { children: found, root } = byParent(skeleton);
  const children = new Map(state.children);
  function forget(id: string) {
    for (const folder of children.get(id) ?? NONE) {
      forget(folder.id);
    }
    children.delete(id);
  }
  for (const parentId of parentIds) {
    const now = found.get(parentId) ?? [];
    const ids = new Set(now.map((folder) => folder.id));
    for (const folder of children.get(parentId) ?? NONE) {
      if (!ids.has(folder.id)) {
        forget(folder.id);
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
 * `state` with the folders `skeleton` has in place of those the tree knows by their IDs, as
 * their tiles changed, and the library's folder's tile. Folders the tree does not know yet are
 * left out: they come with their folder's subfolders.
 */
function withTiles(state: TreeState, skeleton: FolderSkeleton): TreeState {
  const { children: found, root } = byParent(skeleton);
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
 * The folders the tree knows inside the root `rootId` that have folders of their own, the root's
 * own first and then down a level at a time, as "expand all" opens them.
 */
export function foldersWithSubfolders(state: TreeState, rootId: string): string[] {
  return foldersInside(state, rootId).filter((id) => state.children.has(id));
}

/** The folders the tree knows inside `id`, however deep, its own first and then down a level at a time. */
export function foldersInside(state: TreeState, id: string): string[] {
  const found: string[] = [];
  let level = [id];
  while (level.length > 0) {
    level = level.flatMap((parentId) => subfoldersIn(state, parentId).map((folder) => folder.id));
    found.push(...level);
  }
  return found;
}

/**
 * Every folder of a library the catalog knows, and the folders the tree has open, for
 * `useSyncExternalStore`, so opening and closing folders asks nothing of another process. The
 * catalog knows folders from earlier sessions too; as the worker reads folders anew, the window
 * reads the subfolders of those that changed again (`reread`). The main process remembers which
 * folders were opened and closed for the library, so its next session opens them again.
 */
export function folderTreeStore(session: string, api: PhotosAPI) {
  let state = EMPTY_TREE;
  let reading: Promise<unknown> | null = null;
  let remembering: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();

  /** Every folder, which the worker sends as text, as text crosses processes far quicker. */
  async function wholeSkeleton() {
    return skeletonFromText(await api.wholeSkeleton());
  }

  /** Remembers the folders the tree has open for the next session. */
  function remember() {
    clearTimeout(remembering);
    remembering = undefined;
    // Losing them only costs opening them again.
    api.rememberOpenedFolders(session, [...state.opened]).catch(() => null);
  }

  function set(next: TreeState) {
    state = next;
    for (const listener of listeners) {
      listener();
    }
  }

  /**
   * Reads the subfolders of `parentIds` again from the catalog, as changes or reads of the disk
   * changed them, or every folder without `parentIds`. Settles once the tree has them.
   */
  async function reread(parentIds?: Iterable<string>) {
    const ids = parentIds && [...new Set(parentIds)];
    if (ids?.length === 0) {
      return;
    }
    const some = ids && ids.length <= MAX_REREAD ? ids : undefined;
    try {
      if (some) {
        const skeleton = await api.folderSkeleton(some);
        set(withSubfolders(state, some, skeleton));
      } else {
        // The state as it is once the read is in, as other reads may have changed it meanwhile.
        const skeleton = await wholeSkeleton();
        set(withSkeleton(state, skeleton));
      }
    } catch {
      // The tree shows the folders as it knew them until the next change reads them again.
    }
  }

  /**
   * Reads the folders at `folderIds` again from the catalog, as their tiles changed, in place.
   * Settles once the tree has them.
   */
  async function retile(folderIds: Iterable<string>) {
    const ids = [...new Set(folderIds)];
    if (ids.length === 0) {
      return;
    }
    if (ids.length > MAX_REREAD) {
      await reread();
      return;
    }
    try {
      const skeleton = await api.folderTiles(ids);
      set(withTiles(state, skeleton));
    } catch {
      // The tree shows the tiles as it knew them until the next change reads them again.
    }
  }

  return {
    /** Remembers at once the folders opened or closed since the tree last did, if any. */
    flush() {
      if (remembering !== undefined) {
        remember();
      }
    },

    getSnapshot: (): TreeState => state,

    /**
     * Reads the library's folders and which folders were opened or closed when it was last
     * open, once a session. Neither waits for the disk.
     */
    read(): Promise<unknown> {
      reading ??= Promise.all([
        // Without them, the tree opens as it would the first time.
        api.openedFolders().then(
          (saved) => new Map(saved),
          () => null,
        ),
        // Without them, the tree shows the folders as the worker's reads of them tell.
        wholeSkeleton().catch(() => null),
      ]).then(([opened, skeleton]) => {
        const next = skeleton ? withSkeleton(state, skeleton) : state;
        set(opened ? { ...next, opened } : next);
      });
      return reading;
    },

    reread,

    retile,

    /** Opens and closes folders in the tree, and remembers them for the next session. */
    setOpened(opened: ReadonlyMap<string, boolean>) {
      set({ ...state, opened });
      clearTimeout(remembering);
      remembering = setTimeout(remember, REMEMBER_MS);
    },

    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export type FolderTreeStore = ReturnType<typeof folderTreeStore>;
