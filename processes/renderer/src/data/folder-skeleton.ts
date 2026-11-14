import type {
  FolderChange,
  FolderListing,
  FolderSkeleton,
  FolderSummary,
  PhotoEntry,
  PhotosAPI,
  SkeletonCover,
} from '@prism/shared';

// Past this many folders changed at once, the tree reads every folder again rather than each.
const MAX_REREAD = 4096;

/** What the sidebar's tree shows: the folders the catalog knows, and which the tree has open. */
export interface TreeState {
  /** Each folder's subfolders, by name, by its ID; a folder with none known has no entry. */
  children: ReadonlyMap<string, readonly PhotoEntry[]>;
  /** Folders read to the end, whose subfolders `children` holds all of. */
  listed: ReadonlySet<string>;
  /** Folders opened, `true`, or closed by hand; the rest open if they hold the current folder. */
  opened: ReadonlyMap<string, boolean>;
}

const NONE: readonly PhotoEntry[] = [];

export const EMPTY_TREE: TreeState = { children: new Map(), listed: new Set(), opened: new Map() };

/** The subfolders of `id` the tree knows, by name. */
export function subfoldersIn(state: TreeState, id: string): readonly PhotoEntry[] {
  return state.children.get(id) ?? NONE;
}

/** A cover as the skeleton names its thumbnail, as an entry. */
function coverEntry([id, kind, size, modifiedMs, inode]: SkeletonCover): PhotoEntry {
  // IDs are paths, separated however the system separates them.
  const end = Math.max(id.lastIndexOf('/'), id.lastIndexOf('\\'));
  const name = id.slice(end + 1);
  const parentId = end === -1 ? '.' : id.slice(0, end);
  const metadata: PhotoEntry['metadata'] = { accessedMs: 0, createdMs: 0, modifiedMs, size };
  if (inode !== null) {
    metadata.inode = inode;
  }
  return { id, kind, metadata, name, parentId };
}

/**
 * The skeleton's folders, as entries with their tiles, under each folder holding them, in order.
 * Folders that share covers share their entries too.
 */
function byParent({ folders, covers, listed }: FolderSkeleton) {
  const read = new Set(listed);
  const coverSets = covers.map((set) => set.map((cover) => coverEntry(cover)));
  const children = new Map<string, PhotoEntry[]>();
  for (const [id, parentId, name, tile] of folders) {
    const entry: PhotoEntry = { id, kind: 'directory', name, parentId };
    if (tile) {
      const [hasEntries, hasSubfolders, at] = tile;
      const summary: FolderSummary = {
        covers: coverSets[at] ?? [],
        hasEntries,
        hasSubfolders,
        read: read.has(id),
      };
      entry.summary = summary;
    }
    const siblings = children.get(parentId);
    if (siblings) {
      siblings.push(entry);
    } else {
      children.set(parentId, [entry]);
    }
  }
  return children;
}

/** `state` with every folder as `skeleton` has them. */
export function withSkeleton(state: TreeState, skeleton: FolderSkeleton): TreeState {
  return { ...state, children: byParent(skeleton), listed: new Set(skeleton.listed) };
}

/**
 * `state` with the subfolders of each of `parentIds` replaced by those `skeleton` has, whole,
 * and whether each was read to the end. Folders no longer there take what the tree knew inside
 * them along.
 */
export function withSubfolders(
  state: TreeState,
  parentIds: Iterable<string>,
  skeleton: FolderSkeleton,
): TreeState {
  return withFound(state, parentIds, byParent(skeleton), new Set(skeleton.listed));
}

/** `state` with the subfolders of each of `parentIds` as `found` has them; see `withSubfolders`. */
function withFound(
  state: TreeState,
  parentIds: Iterable<string>,
  found: ReadonlyMap<string, PhotoEntry[]>,
  read: ReadonlySet<string>,
): TreeState {
  const children = new Map(state.children);
  const listed = new Set(state.listed);
  function forget(id: string) {
    for (const folder of children.get(id) ?? NONE) {
      forget(folder.id);
    }
    children.delete(id);
    listed.delete(id);
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
    if (read.has(parentId)) {
      listed.add(parentId);
    } else {
      listed.delete(parentId);
    }
  }
  return { ...state, children, listed };
}

/**
 * The folders whose subfolders `changed` changed, as the tree knows them: those a folder came
 * to, or left, or became something else in.
 */
function branchedBy(state: TreeState, changed: FolderChange[]): string[] {
  return changed
    .filter(
      ({ id, parentId, entry, listingChanged }) =>
        listingChanged &&
        (entry?.kind === 'directory' ||
          subfoldersIn(state, parentId).some((folder) => folder.id === id)),
    )
    .map(({ parentId }) => parentId);
}

/**
 * The folders the tree knows inside the root `rootId` that have folders of their own, the root's
 * own first and then down a level at a time, as "expand all" opens them.
 */
export function foldersWithSubfolders(state: TreeState, rootId: string): string[] {
  const found: string[] = [];
  let level = [rootId];
  while (level.length > 0) {
    level = level.flatMap((id) => subfoldersIn(state, id).map((folder) => folder.id));
    found.push(...level.filter((id) => state.children.has(id)));
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
  const listeners = new Set<() => void>();

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
      const skeleton = await api.folderSkeleton(some);
      set(some ? withSubfolders(state, some, skeleton) : withSkeleton(state, skeleton));
    } catch {
      // The tree shows the folders as it knew them until the next change reads them again.
    }
  }

  return {
    /** Reads again the subfolders of the folders `changed` added a folder to or took one from. */
    follow: (changed: FolderChange[]) => reread(branchedBy(state, changed)),

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
        // Without them, the tree shows the folders as listings of them are read.
        api.folderSkeleton().catch(() => null),
      ]).then(([opened, skeleton]) => {
        const next = skeleton ? withSkeleton(state, skeleton) : state;
        set(opened ? { ...next, opened } : next);
      });
      return reading;
    },

    reread,

    /** Opens and closes folders in the tree, and remembers them for the next session. */
    setOpened(opened: ReadonlyMap<string, boolean>) {
      set({ ...state, opened });
      // Losing them only costs opening them again.
      api.rememberOpenedFolders(session, [...opened]).catch(() => null);
    },

    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    /**
     * Takes the subfolders of a listing the window read of `parentId`, which lists them all. One
     * that failed lists nothing, which says nothing of its subfolders.
     */
    takeListing(parentId: string, listing: FolderListing) {
      if (listing.error !== null) {
        return;
      }
      // Listed with their tiles, as the skeleton has them.
      const folders = listing.entries.filter((entry) => entry.kind === 'directory');
      set(withFound(state, [parentId], new Map([[parentId, folders]]), new Set([parentId])));
    },
  };
}

export type FolderTreeStore = ReturnType<typeof folderTreeStore>;
