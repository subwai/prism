import type { LibrarySession } from '#data/library';
import type { PhotosAPI } from '@prism/shared';

/**
 * The folders the tree opened or closed by hand, by ID, for `useSyncExternalStore`. The main
 * process remembers them for the folder, so its next session opens them again.
 */
export class OpenedFolderStore {
  private folders: ReadonlyMap<string, boolean> = new Map();
  private reading: Promise<unknown> | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly session: string,
    private readonly api: PhotosAPI,
  ) {}

  /** Reads which folders were opened or closed when the folder was last open, once a session. */
  read(): Promise<unknown> {
    this.reading ??= this.api.openedFolders().then(
      (saved) => {
        this.folders = new Map(saved);
      },
      // Without them, the tree opens as it would the first time.
      () => null,
    );
    return this.reading;
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = () => this.folders;

  /** Opens and closes folders in the tree, and remembers them for the next session. */
  set(folders: ReadonlyMap<string, boolean>) {
    this.folders = folders;
    for (const listener of this.listeners) {
      listener();
    }
    // Losing them only costs opening them again.
    this.api.rememberOpenedFolders(this.session, [...folders]).catch(() => null);
  }
}

const stores = new WeakMap<LibrarySession, OpenedFolderStore>();

/** The folders `library`'s tree opened or closed by hand, kept as long as the session. */
export function openedFoldersOf(library: LibrarySession): OpenedFolderStore {
  let store = stores.get(library);
  if (!store) {
    store = new OpenedFolderStore(library.root.session, library.api);
    stores.set(library, store);
  }
  return store;
}
