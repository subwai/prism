import { coversChangedBy, foldersAfter, touchedBy } from '#data/folder-changes';
import { type FolderTreeStore, folderTreeStore } from '#data/folder-skeleton';
import type { GalleryView } from '#data/gallery-view';
import { KeptViews } from '#data/kept-views';
import { MediaCache } from '#data/media-cache';
import { createPendingEdits } from '#data/pending-edits';
import { about, allBut, createQueryClient } from '#data/queries';
import { withFoldersMoved } from '#data/renames';
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
  type TrashAPI,
  type ViewSpec,
} from '@prism/shared';
import { queryOptions } from '@tanstack/react-query';

const logChanges = debug('renderer:changes');

/**
 * A folder's session, independent of React and routing: the views the worker holds of it, and the
 * queries views read of what is inside the folder. Route loaders read the queries they wait for;
 * components read them with `useSuspenseQuery`. Changes on disk and refreshes invalidate queries,
 * whose old data shows until fresh data replaces it, and give views new versions.
 */
export class LibrarySession {
  readonly id = crypto.randomUUID();
  readonly queries = createQueryClient();
  private readonly interest = new Map<string, number>();
  private readonly listings = new RequestQueue(2);
  private readonly inspections = new RequestQueue(4, (id) => this.interest.has(id));
  readonly media: MediaCache;
  /** The library's folders and which the sidebar's tree has open. */
  readonly tree: FolderTreeStore;
  private folders = new Map<string, PhotoEntry>();
  readonly edits = createPendingEdits();
  private readonly views: KeptViews;
  /** The folder the gallery shows. */
  private shown: string | null = null;
  private readonly lostListeners = new Set<() => void>();
  private readonly stopListening: (() => void)[];

  constructor(
    readonly root: PhotoRoot,
    readonly api: PhotosAPI,
    readonly trash: TrashAPI,
  ) {
    this.media = new MediaCache(api, this.queries, (id) => this.interest.has(id));
    this.tree = folderTreeStore(root.session, api);
    this.views = new KeptViews(api, this.queries, {
      follow: (id) => this.edits.follow(id),
      found: (entries) => this.rememberFolders(entries),
      trash,
    });
    this.stopListening = [
      api.onStale((entryIds) => this.media.forget(entryIds)),
      api.onUpdate((update) => this.applyUpdate(update)),
    ];
  }

  /**
   * Takes an update from the worker: its changes first, then the views' versions that hold
   * them, so nothing reads a version before what the changes made stale is marked so.
   */
  private applyUpdate({ changes, views, folders = [] }: LibraryUpdate) {
    const lost = changes ? this.applyChanges(changes).lost : false;
    this.tree.reread(folders);
    this.views.update(views);
    if (lost) {
      for (const listener of this.lostListeners) {
        listener();
      }
    }
  }

  /**
   * Hears when the open folder, or one holding it, is gone, or too much changed to list, so
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
            this.tree.takeListing(directoryId, listing);
            return listing;
          } catch (error) {
            return { entries: [], error: String(error), errors: [], missing: false };
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
      queryFn: ({ signal }) =>
        this.inspections.run(
          directoryId,
          (): Promise<FolderSummary | null> =>
            this.api.inspectFolder(directoryId).catch(() => null),
          signal,
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

  /** Makes the thumbnail if it is not cached, once the entry is wanted on screen. */
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
    this.queries.invalidateQueries(allBut('thumbnail')).catch(() => null);
    this.tree.reread();
  }

  /**
   * Brings what the session has read up to date with changes on disk. Nothing is patched:
   * what a change may have touched is dropped or read again, and shows as it was until then.
   * Thumbnails and originals of changed contents went already, as the worker told of them
   * ahead of the changes. `lost` is true if the open view must be read again instead, which the
   * router does; `read` settles once the listings on screen are read again.
   */
  applyChanges({ changed, everything }: FolderChanges): { lost: boolean; read: Promise<unknown> } {
    logChanges('%o', everything ? 'everything' : changed.map(({ id }) => id));
    if (everything) {
      return { lost: true, read: this.refresh() };
    }
    // The open folder, or one holding it, is gone; reading it again says so.
    const open = this.shown === null ? null : this.trail(this.shown);
    const lost = changed.some(
      ({ id, entry }) => entry === null && open?.some((folder) => folder.id === id),
    );
    const { parents, relisted, removed } = touchedBy(changed);
    this.folders = foldersAfter(this.folders, changed);
    this.edits.found(changed.flatMap(({ id, entry }) => (entry ? [id] : [])));
    this.queries.removeQueries({
      predicate: ({ queryKey }) => about(queryKey, ['directory', 'summary'], removed),
    });
    this.queries
      .invalidateQueries({ predicate: coversChangedBy(this.root.id, relisted) })
      .catch(() => null);
    // Listings of folder previews, and the tree's folders. Views follow the changes in the
    // worker, which gives them new versions.
    const read = Promise.all([
      this.queries.invalidateQueries({
        predicate: ({ queryKey }) => about(queryKey, ['directory'], parents),
      }),
      this.tree.follow(changed),
    ]);
    return { lost, read };
  }

  /**
   * Renames an entry, which shows at once as a pending edit, once the listings on screen show
   * it under its new name. `lost` is true if the open view must be read again, as its folder or
   * one holding it was renamed; the edits' `follow` then finds it. A failure stays in the
   * edits' `failures` until seen, whatever shows meanwhile.
   */
  rename(entryId: string, name: string) {
    const id = this.edits.follow(entryId);
    return this.edits.run(id, 'name', name, async (edit) => {
      const result = await this.api.renameEntry(id, name);
      if ('error' in result) {
        this.edits.failed(entryId, name, result.error);
        return result;
      }
      this.media.forget(staleEntries(result.changes));
      const { lost, read } = this.applyChanges({ changed: result.changes, everything: false });
      if (result.entry.id !== id) {
        this.folders = withFoldersMoved(this.folders, id, result.entry.id);
      }
      this.edits.renamed(id, edit, result.entry);
      await read;
      return { entry: result.entry, lost };
    });
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
