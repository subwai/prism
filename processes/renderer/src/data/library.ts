import { AttentionReporter } from '#data/attention';
import { foldersIn, type FolderTreeStore, folderTreeStore } from '#data/folder-skeleton';
import type { GalleryView } from '#data/gallery-view';
import { KeptViews } from '#data/kept-views';
import { MediaCache } from '#data/media-cache';
import { createPendingEdits } from '#data/pending-edits';
import { about, allBut, createQueryClient } from '#data/queries';
import { folderIn, type FolderTrail, isWithin, type KnownFolders, trailIn } from '#data/trails';
import {
  debug,
  type FolderChanges,
  type FolderListing,
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
  /** What the window has on show, which orders the worker's reads of the disk. */
  readonly attention: AttentionReporter;
  readonly media: MediaCache;
  /** The library's folders and which the sidebar's tree has open. */
  readonly tree: FolderTreeStore;
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
    this.attention = new AttentionReporter(api);
    this.media = new MediaCache(api, this.queries, (id) => this.attention.has(id));
    this.tree = folderTreeStore(root.session, api);
    this.views = new KeptViews(api, this.queries, {
      follow: (id) => this.edits.follow(id),
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
    // Their subfolders' rows, with their tiles, as listings of them show them.
    this.queries
      .invalidateQueries({
        predicate: ({ queryKey }) => about(queryKey, ['directory'], new Set(folders)),
      })
      .catch(() => null);
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
   * Marks an entry as on screen, which the worker hears of: what it was asked to make of entries
   * that scrolled away is dropped, so the visible ones are not stuck behind it. Originals waiting
   * here for an entry that scrolled away wait until it is wanted again.
   */
  want(entryId: string) {
    const release = this.attention.show(entryId);
    this.media.wake(entryId);
    return release;
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

  /**
   * A folder's shallow listing as the catalog has it, which never waits for the disk. The worker
   * reads the folder meanwhile, and the listing is read again once that changes it.
   */
  directoryQuery(directoryId: string) {
    return queryOptions({
      queryFn: async (): Promise<FolderListing> => {
        try {
          return await this.api.listFolder(directoryId);
        } catch (error) {
          return { entries: [], error: String(error), missing: false, read: false };
        }
      },
      queryKey: ['directory', directoryId],
    });
  }

  /** Reads a folder's listing from the catalog, or again if a change or read invalidated it. */
  directory(directoryId: string) {
    return this.queries.fetchQuery(this.directoryQuery(directoryId));
  }

  peekDirectory(directoryId: string) {
    return this.queries.getQueryData(this.directoryQuery(directoryId).queryKey);
  }

  /**
   * The library's folders as the window knows them now, for loaders and event handlers;
   * components read the tree and the edits with `useKnownFolders` instead.
   */
  private known(): KnownFolders {
    return { edits: this.edits.getSnapshot(), tree: this.tree.getSnapshot() };
  }

  /** The folder at `id`, with its tile; see `folderIn`. */
  folder(id: string): PhotoEntry | undefined {
    return folderIn(this.known(), id);
  }

  /** The folders from the root down to `id`, or `null` if it is not a known folder. */
  trail(id: string): FolderTrail | null {
    return trailIn(this.root, this.known(), id);
  }

  /**
   * Has the worker read the tile of a folder on show whose row may not say all it shows, in the
   * background while it is on show: its row changes as the catalog does, and nothing waits for
   * it. Returns what to call once it is no longer on show, which drops the read if it has not
   * started.
   */
  readTile(folderId: string) {
    return this.attention.showTile(folderId);
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
   * Brings what the session has read up to date with changes on disk, which the catalog has
   * already. Nothing is patched: what a change may have touched is read again from the catalog,
   * and shows as it was until then. Thumbnails and originals of changed contents went already,
   * as the worker told of them ahead of the changes. `lost` is true if the open view must be
   * read again instead, which the router does; `read` settles once the listings on screen and
   * the tree are read again.
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
    this.edits.found(changed.flatMap(({ id, entry }) => (entry ? [id] : [])));
    // The listings of what changed and of the folders holding it, however deep, as their tiles
    // may show it, and the subfolders of the folders whose listings changed. Views follow the
    // changes in the worker, which gives them new versions.
    const ids = [...new Set(changed.map(({ id }) => id))];
    const read = Promise.all([
      this.queries.invalidateQueries({
        predicate: ({ queryKey: [kind, folderId] }) =>
          kind === 'directory' && ids.some((id) => isWithin(this.root.id, String(folderId), id)),
      }),
      this.tree.reread(
        changed.filter((change) => change.listingChanged).map(({ parentId }) => parentId),
      ),
    ]);
    return { lost, read };
  }

  /**
   * Renames an entry, which shows at once as a pending edit, until the listings on screen and
   * the tree, read again from the catalog, show it under its new name. `lost` is true if the
   * open view must be read again, as its folder or one holding it was renamed; the edits'
   * renames then lead to it. A failure stays in the edits' `failures` until seen, whatever
   * shows meanwhile.
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
      // Before the tree reads the folder again, which forgets what it knew inside it.
      this.edits.renamed(id, edit, result.entry, foldersIn(this.tree.getSnapshot()).values());
      const { lost, read } = this.applyChanges({ changed: result.changes, everything: false });
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
    this.attention.close();
    this.views.clear();
    this.media.clear();
    this.queries.clear();
  }
}
