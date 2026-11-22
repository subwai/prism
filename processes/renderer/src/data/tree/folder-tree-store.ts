import {
  EMPTY_TREE,
  type TreeState,
  withChangedTiles,
  withSubfolders,
  withWholeTree,
} from '#data/tree/tree-state';
import { type PhotosAPI, treeListingFromText } from '@prism/shared';

// Past this many folders changed at once, the tree reads every folder again rather than each one.
const MAX_FOLDERS_TO_REREAD = 4096;

// How long the tree waits after a folder opens or closes before saving which are open. Opening
// folder after folder with the arrow keys then saves once, and never inside the keypress's own
// task. When the window goes away it saves at once (`saveOpenedFoldersNow`).
const SAVE_OPENED_DELAY_MS = 250;

/**
 * The store behind the sidebar's tree, for `useSyncExternalStore`. It holds every folder of the
 * library the catalog knows, and which folders the tree has open, so opening and closing a folder
 * never calls another process.
 *
 * The catalog also knows folders from earlier sessions. As the worker reads folders again, the
 * window rereads the subfolders of those that changed (`rereadSubfolders`). The main process
 * saves which folders were open for each library, so its next session opens them again.
 */
export function createFolderTreeStore(session: string, api: PhotosAPI) {
  let state = EMPTY_TREE;
  let reading: Promise<unknown> | null = null;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();

  /** Every folder. The worker sends them as text, because text crosses processes far quicker. */
  async function readWholeTree() {
    return treeListingFromText(await api.listWholeTree());
  }

  /** Saves which folders the tree has open, for the next session. */
  function saveOpenedFolders() {
    clearTimeout(saveTimer);
    saveTimer = undefined;
    // Losing them only costs opening them again.
    api.rememberOpenedFolders(session, [...state.opened]).catch(() => null);
  }

  function setState(next: TreeState) {
    state = next;
    for (const listener of listeners) {
      listener();
    }
  }

  /**
   * Reads the subfolders of `parentIds` again from the catalog, after changes on disk or the
   * worker's reads changed them. Without `parentIds`, it reads every folder. Settles once the
   * tree has them.
   */
  async function rereadSubfolders(parentIds?: Iterable<string>) {
    const ids = parentIds && [...new Set(parentIds)];
    if (ids?.length === 0) {
      return;
    }
    const some = ids && ids.length <= MAX_FOLDERS_TO_REREAD ? ids : undefined;
    try {
      // Each read is applied to the state as it is once the read is in, as other reads may have
      // changed it meanwhile.
      if (some) {
        const listing = await api.listSubfolders(some);
        setState(withSubfolders(state, some, listing));
      } else {
        const listing = await readWholeTree();
        setState(withWholeTree(state, listing));
      }
    } catch {
      // The tree shows the folders as it knew them until the next change reads them again.
    }
  }

  /**
   * Reads the folders at `folderIds` again from the catalog, because their tiles changed, and
   * puts them in place. Settles once the tree has them.
   */
  async function refreshFolderTiles(folderIds: Iterable<string>) {
    const ids = [...new Set(folderIds)];
    if (ids.length === 0) {
      return;
    }
    if (ids.length > MAX_FOLDERS_TO_REREAD) {
      await rereadSubfolders();
      return;
    }
    try {
      const listing = await api.listFoldersById(ids);
      setState(withChangedTiles(state, listing));
    } catch {
      // The tree shows the tiles as it knew them until the next change reads them again.
    }
  }

  return {
    getSnapshot: (): TreeState => state,

    /**
     * Reads the library's folders, and which folders were open when it was last open. It reads
     * them once a session, and neither waits for the disk.
     */
    readOnce(): Promise<unknown> {
      reading ??= Promise.all([
        // Without them, the tree opens as it would the first time.
        api.openedFolders().then(
          (saved) => new Map(saved),
          () => null,
        ),
        // Without them, the tree shows the folders as the worker reads them.
        readWholeTree().catch(() => null),
      ]).then(([opened, listing]) => {
        const next = listing ? withWholeTree(state, listing) : state;
        setState(opened ? { ...next, opened } : next);
      });
      return reading;
    },

    refreshFolderTiles,

    rereadSubfolders,

    /** Saves at once which folders are open, if any opened or closed since the last save. */
    saveOpenedFoldersNow() {
      if (saveTimer !== undefined) {
        saveOpenedFolders();
      }
    },

    /** Opens and closes folders in the tree, and saves them for the next session. */
    setOpened(opened: ReadonlyMap<string, boolean>) {
      setState({ ...state, opened });
      clearTimeout(saveTimer);
      saveTimer = setTimeout(saveOpenedFolders, SAVE_OPENED_DELAY_MS);
    },

    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export type FolderTreeStore = ReturnType<typeof createFolderTreeStore>;
