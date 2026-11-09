import { patchEntries } from '#data/folder-changes';
import type { GalleryView } from '#data/gallery-view';
import { KeptViews } from '#data/kept-views';
import { MediaCache } from '#data/media-cache';
import { about, createQueryClient } from '#data/queries';
import { followRenames, type Renames, withFoldersMoved, withRename } from '#data/renames';
import { RequestQueue } from '#data/request-queue';
import { type FolderTrail, trailIn } from '#data/trails';
import {
  debug,
  type FolderChanges,
  type FolderListing,
  type FolderSummary,
  type LibraryUpdate,
  type PhotoEntry,
  type PhotoRoot,
  type PhotosAPI,
  staleEntries,
  type ViewSpec,
} from '@prism/shared';
import { queryOptions } from '@tanstack/react-query';

const logChanges = debug('renderer:changes');

/**
 * A folder's session, independent of React and routing: the views the worker holds of it, and
 * the queries views read of what is inside the folder. Route loaders read the queries they
 * wait for; components read them with `useSuspenseQuery`. Changes on disk and refreshes
 * invalidate queries, whose old data shows until fresh data replaces it, and give views new
 * versions.
 */
export class PhotoLibrary {
  readonly id = crypto.randomUUID();
  readonly queries = createQueryClient();
  private readonly interest = new Map<string, number>();
  private readonly listings = new RequestQueue(2);
  private readonly inspections = new RequestQueue(4, (id) => this.interest.has(id));
  private readonly media: MediaCache;
  private folders = new Map<string, PhotoEntry>();
  private renames: Renames = new Map();
  private readonly views: KeptViews;
  /** The folder the gallery shows. */
  private shown: string | null = null;
  private readonly lostListeners = new Set<() => void>();
  private readonly stopListening: (() => void)[];

  constructor(
    readonly root: PhotoRoot,
    readonly api: PhotosAPI,
  ) {
    this.media = new MediaCache(api, this.queries, (id) => this.interest.has(id));
    this.views = new KeptViews(api, this.queries, {
      follow: (id) => this.follow(id),
      found: (entries) => this.rememberFolders(entries),
    });
    this.stopListening = [
      api.onStale((entryIds) => this.media.forget(entryIds)),
      api.onUpdate((update) => this.applyUpdate(update)),
    ];
  }

  /**
   * Takes an update from the worker: its changes first, then the views' versions that hold
   * them, so nothing reads a version for what the changes have yet to patch.
   */
  private applyUpdate({ changes, views }: LibraryUpdate) {
    const lost = changes ? this.applyChanges(changes) : false;
    this.views.update(views);
    if (lost) {
      for (const listener of this.lostListeners) {
        listener();
      }
    }
  }

  /**
   * Hears when the open folder, or one holding it, is gone, or too much changed to patch, so
   * the open view must be read again; returns the unsubscribe function.
   */
  onLost(listener: () => void): () => void {
    this.lostListeners.add(listener);
    return () => this.lostListeners.delete(listener);
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

  /**
   * The view of what `spec` asks for, opened in the worker or kept from an earlier visit, which
   * shows again as it is.
   */
  view(spec: ViewSpec): Promise<GalleryView> {
    return this.views.view(spec);
  }

  /** The view the gallery shows, whose folder going away reads it again to say so. */
  openGallery(spec: ViewSpec): Promise<GalleryView> {
    this.shown = spec.directoryId;
    return this.views.view(spec);
  }

  /** A folder's complete, shallow listing. */
  directoryQuery(directoryId: string) {
    return queryOptions({
      queryFn: () =>
        this.listings.run(directoryId, async (): Promise<FolderListing> => {
          try {
            const listing = await this.api.listFolder(directoryId);
            this.rememberFolders(listing.entries);
            return listing;
          } catch (error) {
            return { entries: [], error: String(error), errors: [] };
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
    return trailIn(this.root, this.folders, id);
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

  /**
   * Reads everything again; what is on screen stays until its fresh data arrives. Open views
   * stay open: the worker reads their folders again and gives them new versions.
   */
  async refresh() {
    this.media.clear();
    // The worker forgets what it remembers of folders first, so the reads below see them anew.
    await this.api.refresh().catch(() => null);
    this.queries.invalidateQueries().catch(() => null);
  }

  /**
   * Brings what the session has read up to date with changes on disk, in place: listings are
   * patched rather than read again. Thumbnails and originals of changed contents went already,
   * as the worker told of them ahead of the changes. True if the open view must be read again
   * instead, which the router does.
   */
  applyChanges({ changed, everything }: FolderChanges) {
    logChanges('%o', everything ? 'everything' : changed.map(({ id }) => id));
    if (everything) {
      this.refresh().catch(() => null);
      return true;
    }
    // The open folder, or one holding it, is gone; reading it again says so.
    const open = this.shown === null ? null : this.trail(this.shown);
    const lost = changed.some(
      ({ id, entry }) => entry === null && open?.some((folder) => folder.id === id),
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
    // Covers can come from deep inside a folder, through folders this window never listed, so
    // every summary is read again; the worker still remembers the ones that did not change.
    if (relisted.size > 0) {
      this.queries.invalidateQueries({ queryKey: ['summary'] }).catch(() => null);
    }
    // Listings open in the sidebar and folder previews.
    for (const parentId of new Set(changed.map((change) => change.parentId))) {
      const listing = this.peekDirectory(parentId);
      const entries = listing && patchEntries(listing.entries, changed, (id) => id === parentId);
      if (listing && entries) {
        this.queries.setQueryData(this.directoryQuery(parentId).queryKey, { ...listing, entries });
      }
    }
    // Views follow the changes in the worker, which gives them new versions.
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
    this.media.forget(staleEntries(result.changes));
    const lost = this.applyChanges({ changed: result.changes, everything: false });
    if (result.entry.id !== entryId) {
      this.renames = withRename(this.renames, entryId, result.entry.id);
      this.folders = withFoldersMoved(this.folders, entryId, result.entry.id);
    }
    return { entry: result.entry, lost };
  }

  /** Where an entry renamed in this window is now. Only for IDs no longer found. */
  follow(id: string) {
    return followRenames(this.renames, id);
  }

  /** Closes every view, so the next ones read their folders again. */
  dispose() {
    this.views.clear();
  }

  /** Ends the session, as another folder opens. */
  close() {
    for (const stop of this.stopListening) {
      stop();
    }
    this.views.clear();
    this.media.clear();
    this.queries.clear();
  }
}
