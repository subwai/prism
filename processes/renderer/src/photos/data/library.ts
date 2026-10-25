import { type DirectoryScan, openScan, type ScanState } from '#photos/data/directory-scan';
import { lists, patchEntries } from '#photos/data/folder-changes';
import { MediaCache } from '#photos/data/media-cache';
import { Renames } from '#photos/data/renames';
import { RequestQueue } from '#photos/data/request-queue';
import { ResourceCache } from '#photos/data/resource-cache';
import { carryOver, keep, peek } from '#photos/data/stale';
import type {
  FolderChange,
  FolderChanges,
  FolderSummary,
  PhotoEntry,
  PhotoFolder,
  PhotosAPI,
  ScanOptions
} from '@prism/shared';

/** Reads a scan to the end. */
async function readAll(api: PhotosAPI, options: ScanOptions) {
  const always = new AbortController().signal;
  const scan = await openScan(api, options, always);
  let state = await scan.next(always);
  while (state.loading) {
    state = await scan.next(always);
  }
  return state;
}

/**
 * Session cache and IPC backpressure, independent of React and routing. Reads return
 * shared promises for `use()`; `peek*` returns settled values so cached views paint at once.
 */
export class PhotoLibrary {
  readonly id = crypto.randomUUID();
  /** Bumped by `refresh`; views holding derived data reload it without remounting. */
  generation = 0;
  private gallery: { scan: DirectoryScan; options: ScanOptions } | null = null;
  private version = 0;
  private readonly listeners = new Set<() => void>();
  private readonly interest = new Map<string, number>();
  private readonly directories = new ResourceCache<ScanState>(new RequestQueue(2), 64, () =>
    this.changed()
  );
  private readonly summaries = new ResourceCache<FolderSummary | null>(new RequestQueue(4), 256);
  private readonly media: MediaCache;
  // After a refresh or change the previous results keep rendering until fresh ones arrive.
  private staleDirectories = new Map<string, ScanState>();
  private staleSummaries = new Map<string, FolderSummary | null>();
  private readonly folders = new Map<string, PhotoEntry>();
  private readonly renames = new Renames();

  constructor(
    readonly root: PhotoFolder,
    readonly api: PhotosAPI
  ) {
    this.media = new MediaCache(api);
  }

  /** `useSyncExternalStore` source for directory reads. */
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getVersion = () => this.version;

  private changed() {
    this.version += 1;
    for (const listener of this.listeners) {
      listener();
    }
  }

  /**
   * Marks an entry as on screen. Queued thumbnail and cover work for entries that scrolled
   * away waits until they are read again, so the visible ones are not stuck behind it.
   */
  want(entryId: string) {
    this.interest.set(entryId, (this.interest.get(entryId) ?? 0) + 1);
    return () => {
      const count = (this.interest.get(entryId) ?? 1) - 1;
      if (count === 0) {
        this.interest.delete(entryId);
      } else {
        this.interest.set(entryId, count);
      }
    };
  }

  private wanted(entryId: string) {
    return () => this.interest.has(entryId);
  }

  private rememberFolders(entries: PhotoEntry[]) {
    for (const entry of entries) {
      if (entry.kind === 'directory') {
        this.folders.set(entry.id, entry);
      }
    }
  }

  /** Opens the view's scan and reads its first page; later pages stream into the scan. */
  async openGallery(options: ScanOptions, signal: AbortSignal) {
    this.gallery?.scan.close();
    const scan = await openScan(this.api, options, signal);
    this.gallery = { options, scan };
    this.rememberFolders((await scan.next(signal)).entries);
    scan.subscribe(() => this.rememberFolders(scan.getSnapshot().entries));
    scan.stream();
    return scan;
  }

  /** A folder's complete, shallow listing. */
  directory(directoryId: string) {
    return this.directories.read(directoryId, async () => {
      try {
        const state = await readAll(this.api, { directoryId });
        this.rememberFolders(state.entries);
        return state;
      } catch (error) {
        return { entries: [], error: String(error), errors: [], loading: false };
      }
    });
  }

  peekDirectory(directoryId: string) {
    return peek(this.directories, this.staleDirectories, directoryId);
  }

  trail(id: string) {
    const trail: PhotoFolder[] = [];
    let current = id;
    while (current !== this.root.id) {
      const folder = this.folders.get(current);
      if (!folder || trail.length > 128) {
        return null;
      }
      trail.unshift(folder);
      current = folder.parentId;
    }
    return [this.root, ...trail];
  }

  /** Folder covers and whether a folder has subfolders; `null` if it could not be read. */
  summary(directoryId: string) {
    return this.summaries.read(
      directoryId,
      () => this.api.inspectFolder(directoryId).catch(() => null),
      this.wanted(directoryId)
    );
  }

  peekSummary(directoryId: string) {
    return peek(this.summaries, this.staleSummaries, directoryId);
  }

  /** `owner` is the on-screen entry the thumbnail is for, such as the folder it covers. */
  thumbnail(entryId: string, owner = entryId) {
    return this.media.thumbnail(entryId, this.wanted(owner));
  }

  peekThumbnail(entryId: string) {
    return this.media.peekThumbnail(entryId);
  }

  original(entry: PhotoEntry) {
    return this.media.original(entry);
  }

  peekOriginal(entryId: string) {
    return this.media.peekOriginal(entryId);
  }

  peekOpeningFrame(entryId: string) {
    return this.media.peekOpeningFrame(entryId);
  }

  /** Changes each time the entry's contents change on disk; views key their reads by it. */
  revision(entryId: string) {
    return this.media.revision(entryId);
  }

  refresh() {
    this.dispose();
    this.generation += 1;
    this.media.clear();
    const directories = this.directories.clear();
    this.staleDirectories = carryOver(this.staleDirectories, directories, 64);
    this.staleSummaries = carryOver(this.staleSummaries, this.summaries.clear(), 256);
    // Expanded folders keep their old children on screen while they are read again.
    for (const directoryId of directories.keys()) {
      this.directory(directoryId).catch(() => null);
    }
  }

  /**
   * Brings what the session has read up to date with changes on disk, in place: listings are
   * patched rather than read again, and only changed contents are. True if the open view must
   * be read again instead, which the router does.
   */
  applyChanges({ changed, everything }: FolderChanges) {
    if (everything) {
      this.refresh();
      return true;
    }
    // The open folder, or one holding it, is gone; reading it again says so.
    const open = this.gallery && this.trail(this.gallery.options.directoryId);
    const lost = changed.some(
      ({ id, entry }) => entry === null && open?.some((folder) => folder.id === id)
    );
    for (const { id, parentId, entry, contentChanged, listingChanged } of changed) {
      if (contentChanged || entry === null) {
        this.media.forget(id);
      }
      if (listingChanged) {
        keep(this.staleSummaries, parentId, this.summaries.evict(parentId));
      }
      if (entry?.kind === 'directory') {
        this.folders.set(id, entry);
      } else if (entry === null) {
        this.folders.delete(id);
        this.directories.evict(id);
      }
    }
    this.staleSummaries = carryOver(this.staleSummaries, new Map(), 256);
    // Listings open in the sidebar and folder previews.
    for (const parentId of new Set(changed.map((change) => change.parentId))) {
      const listing = this.directories.peek(parentId)?.value;
      const entries = listing && patchEntries(listing.entries, changed, (id) => id === parentId);
      if (listing && entries) {
        this.directories.replace(parentId, { ...listing, entries });
      }
    }
    this.patchGallery(changed);
    this.changed();
    return lost;
  }

  /**
   * Renames an entry and patches what is on screen at once. `lost` is true if the open view
   * must be read again, as its folder or one holding it was renamed; `follow` then finds it.
   */
  async rename(entryId: string, name: string) {
    const result = await this.api.renameEntry(entryId, name);
    if ('error' in result) {
      return result;
    }
    const lost = this.applyChanges({ changed: result.changes, everything: false });
    if (result.entry.id !== entryId) {
      this.renames.record(entryId, result.entry.id, this.folders);
    }
    return { entry: result.entry, lost };
  }

  /** Where an entry renamed in this window is now. Only for IDs no longer found. */
  follow(id: string) {
    return this.renames.follow(id);
  }

  private patchGallery(changed: FolderChange[]) {
    const { gallery } = this;
    if (!gallery) {
      return;
    }
    const within = (id: string) => lists(gallery.options, id, this.folders, this.root.id);
    gallery.scan.apply(changed, within);
    if (!gallery.options.recursive) {
      return;
    }
    // A folder moved into a recursive gallery brings its contents, which raise no events.
    for (const { entry, listingChanged } of changed) {
      if (listingChanged && entry?.kind === 'directory' && within(entry.parentId)) {
        readAll(this.api, { ...gallery.options, directoryId: entry.id })
          .then((state) => {
            this.rememberFolders(state.entries);
            const added = state.entries.map((child) => ({
              contentChanged: false,
              entry: child,
              id: child.id,
              listingChanged: true,
              parentId: child.parentId
            }));
            gallery.scan.apply(added, within);
          })
          .catch(() => null);
      }
    }
  }

  dispose() {
    this.gallery?.scan.close();
  }
}
