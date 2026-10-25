import { type DirectoryScan, openScan, readAll, type ScanState } from '#data/directory-scan';
import { lists, patchEntries } from '#data/folder-changes';
import { MediaCache } from '#data/media-cache';
import { about, createQueryClient } from '#data/queries';
import { Renames } from '#data/renames';
import { RequestQueue } from '#data/request-queue';
import type {
  FolderChange,
  FolderChanges,
  FolderSummary,
  PhotoEntry,
  PhotoFolder,
  PhotoRoot,
  PhotosAPI,
  ScanOptions,
} from '@prism/shared';
import { queryOptions } from '@tanstack/react-query';

/** Folders from the library's root down to one inside it. */
export type FolderTrail = PhotoFolder[];

/**
 * A folder's session, independent of React and routing: the open view's scan, and the
 * queries views read of what is inside the folder. Route loaders read the queries they wait
 * for; components read them with `useSuspenseQuery`. Changes on disk and refreshes
 * invalidate queries, whose old data shows until fresh data replaces it.
 */
export class PhotoLibrary {
  readonly id = crypto.randomUUID();
  readonly queries = createQueryClient();
  private gallery: { scan: DirectoryScan; options: ScanOptions } | null = null;
  private readonly interest = new Map<string, number>();
  private readonly listings = new RequestQueue(2);
  private readonly inspections = new RequestQueue(4, (id) => this.interest.has(id));
  private readonly media: MediaCache;
  private readonly folders = new Map<string, PhotoEntry>();
  private readonly renames = new Renames();

  constructor(
    readonly root: PhotoRoot,
    readonly api: PhotosAPI,
  ) {
    this.media = new MediaCache(api, this.queries, (id) => this.interest.has(id));
  }

  /**
   * Marks an entry as on screen. Queued thumbnail and summary work for entries that scrolled
   * away waits until they are wanted again, so the visible ones are not stuck behind it.
   */
  want(entryId: string) {
    this.interest.set(entryId, (this.interest.get(entryId) ?? 0) + 1);
    this.media.wake(entryId);
    this.inspections.wake(entryId);
    return () => {
      const count = (this.interest.get(entryId) ?? 1) - 1;
      if (count === 0) {
        this.interest.delete(entryId);
      } else {
        this.interest.set(entryId, count);
      }
    };
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
  directoryQuery(directoryId: string) {
    return queryOptions({
      queryFn: () =>
        this.listings.run(directoryId, async (): Promise<ScanState> => {
          try {
            const state = await readAll(this.api, { directoryId });
            this.rememberFolders(state.entries);
            return state;
          } catch (error) {
            return { entries: [], error: String(error), errors: [], loading: false };
          }
        }),
      queryKey: ['directory', directoryId],
    });
  }

  /** Reads a folder's listing, or reads it again if a change or refresh invalidated it. */
  directory(directoryId: string) {
    return this.queries.fetchQuery(this.directoryQuery(directoryId));
  }

  peekDirectory(directoryId: string) {
    return this.queries.getQueryData(this.directoryQuery(directoryId).queryKey);
  }

  /** The folders from the root down to `id`, or `null` if it is not a known folder. */
  trail(id: string): FolderTrail | null {
    const trail: PhotoFolder[] = [];
    // However deep, a trail passes each known folder once at most.
    for (let current = id; current !== this.root.id;) {
      const folder = this.folders.get(current);
      if (!folder || trail.length > this.folders.size) {
        return null;
      }
      trail.push(folder);
      current = folder.parentId;
    }
    return [this.root, ...trail.toReversed()];
  }

  /**
   * Folder covers and whether a folder has subfolders; `null` if it could not be read. Read
   * once the folder is wanted on screen.
   */
  summaryQuery(directoryId: string) {
    return queryOptions({
      queryFn: () =>
        this.inspections.run(directoryId, (): Promise<FolderSummary | null> =>
          this.api.inspectFolder(directoryId).catch(() => null),
        ),
      queryKey: ['summary', directoryId],
    });
  }

  summary(directoryId: string) {
    return this.queries.fetchQuery(this.summaryQuery(directoryId));
  }

  peekSummary(directoryId: string) {
    return this.queries.getQueryData(this.summaryQuery(directoryId).queryKey);
  }

  /** Read once the entry is wanted on screen. */
  thumbnailQuery(entryId: string) {
    return this.media.thumbnailQuery(entryId);
  }

  thumbnail(entryId: string) {
    return this.queries.fetchQuery(this.thumbnailQuery(entryId));
  }

  peekThumbnail(entryId: string) {
    return this.queries.getQueryData(this.thumbnailQuery(entryId).queryKey);
  }

  originalQuery(entry: PhotoEntry) {
    return this.media.originalQuery(entry);
  }

  peekOpeningFrame(entryId: string) {
    return this.media.peekOpeningFrame(entryId);
  }

  /** Reads everything again; what is on screen stays until its fresh data arrives. */
  async refresh() {
    this.dispose();
    this.media.clear();
    // The worker forgets what it remembers of folders first, so the reads below see them anew.
    await this.api.refresh().catch(() => null);
    this.queries.invalidateQueries().catch(() => null);
  }

  /**
   * Brings what the session has read up to date with changes on disk, in place: listings are
   * patched rather than read again, and only changed contents are. True if the open view must
   * be read again instead, which the router does.
   */
  applyChanges({ changed, everything }: FolderChanges) {
    if (everything) {
      this.refresh().catch(() => null);
      return true;
    }
    // The open folder, or one holding it, is gone; reading it again says so.
    const open = this.gallery && this.trail(this.gallery.options.directoryId);
    const lost = changed.some(
      ({ id, entry }) => entry === null && open?.some((folder) => folder.id === id),
    );
    this.media.forget(
      changed
        .filter((change) => change.contentChanged || change.entry === null)
        .map(({ id }) => id),
    );
    const relisted = new Set<string>();
    const removed = new Set<string>();
    for (const { id, parentId, entry, listingChanged } of changed) {
      if (listingChanged) {
        relisted.add(parentId);
      }
      if (entry?.kind === 'directory') {
        this.folders.set(id, entry);
      } else if (entry === null) {
        this.folders.delete(id);
        removed.add(id);
      }
    }
    this.queries.removeQueries({
      predicate: ({ queryKey }) => about(queryKey, ['directory'], removed),
    });
    this.queries
      .invalidateQueries({ predicate: ({ queryKey }) => about(queryKey, ['summary'], relisted) })
      .catch(() => null);
    // Listings open in the sidebar and folder previews.
    for (const parentId of new Set(changed.map((change) => change.parentId))) {
      const listing = this.peekDirectory(parentId);
      const entries = listing && patchEntries(listing.entries, changed, (id) => id === parentId);
      if (listing && entries) {
        this.queries.setQueryData(this.directoryQuery(parentId).queryKey, { ...listing, entries });
      }
    }
    this.patchGallery(changed);
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

  /** The entry `id` among `entries`, found under its new name if it was renamed since. */
  locate(entries: PhotoEntry[], id: string) {
    return (
      entries.find((entry) => entry.id === id) ??
      entries.find((entry) => entry.id === this.follow(id))
    );
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
              parentId: child.parentId,
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

  /** Ends the session, as another folder opens. */
  close() {
    this.dispose();
    this.media.clear();
    this.queries.clear();
  }
}
