import { createPendingEdits } from '#data/edits/pending-edits';
import { movedId } from '#data/edits/renames';
import { MediaCache } from '#data/media/media-cache';
import { createQueryClient, fetchLatest, isQueryAbout } from '#data/session/queries';
import { ScreenContentsReporter } from '#data/session/screen-contents-reporter';
import { createFolderTreeStore, type FolderTreeStore } from '#data/tree/folder-tree-store';
import {
  folderAt,
  type FolderTrail,
  isWithin,
  type KnownFolders,
  parentIdOf,
  trailIn,
} from '#data/tree/trails';
import { foldersInside } from '#data/tree/tree-state';
import type { GalleryView } from '#data/views/gallery-view';
import { KeptViews } from '#data/views/kept-views';
import {
  debug,
  findStaleEntryIds,
  type FolderChanges,
  type FolderContents,
  type LibraryUpdate,
  type PhotoEntry,
  type PhotoRoot,
  type PhotosAPI,
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
  /** What the window has on screen, which the worker orders its reads of the disk by. */
  readonly screenContents: ScreenContentsReporter;
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
    this.screenContents = new ScreenContentsReporter(api);
    this.media = new MediaCache(api, this.queries, (id) => this.screenContents.isEntryOnScreen(id));
    this.tree = createFolderTreeStore(root.session, api);
    this.views = new KeptViews(api, this.queries, {
      currentIdOf: (id) => this.edits.currentIdOf(id),
      trash,
    });
    this.stopListening = [
      api.onStale((entryIds) => this.media.forgetContents(entryIds)),
      api.onThumbnail((update) => {
        this.media.receiveThumbnail(update).catch(() => null);
      }),
      api.onUpdate((update) => this.applyUpdate(update)),
    ];
  }

  /**
   * Takes an update from the worker: its changes first, then the views' versions that hold
   * them, so nothing reads a version before what the changes made stale is marked so.
   */
  private applyUpdate({ changes, views, folders = [], tiles = [] }: LibraryUpdate) {
    const lost = changes ? this.applyChanges(changes).lost : false;
    // The folders holding those whose tiles changed. No folder holds the library's own.
    const parentsOfTiles = new Set(
      tiles.filter((id) => id !== this.root.id).map((id) => parentIdOf(id)),
    );
    this.tree.rereadSubfolders(folders);
    this.tree.refreshFolderTiles(tiles);
    // Folders whose subfolders changed are read again now. Folders showing a tile that changed
    // are read again only when next used. Otherwise the library folder's contents, which is always
    // in use, would be read again for every tile inside it during a library's first read.
    this.queries
      .invalidateQueries({
        predicate: ({ queryKey }) => isQueryAbout(queryKey, ['directory'], new Set(folders)),
      })
      .catch(() => null);
    this.queries
      .invalidateQueries({
        predicate: ({ queryKey }) => isQueryAbout(queryKey, ['directory'], parentsOfTiles),
        refetchType: 'none',
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
   * Calls `listener` when the open view must be read again: its folder, or one holding it, is
   * gone, or too much changed to list. Returns the unsubscribe function.
   */
  onLost(listener: () => void): () => void {
    this.lostListeners.add(listener);
    return () => this.lostListeners.delete(listener);
  }

  /**
   * Marks an entry as on screen, and returns the function to call once it is not. The worker
   * then makes the entry's thumbnail if it is not cached, and sends it. It also drops what it was
   * making for entries that scrolled away, so the ones on screen are not stuck behind them.
   * Originals waiting here for an entry that scrolled away wait until it is on screen again.
   */
  markEntryOnScreen(entryId: string) {
    const release = this.screenContents.markEntryOnScreen(entryId);
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
   * A folder's contents as the catalog has them, one level deep, which never waits for the disk.
   * The worker reads the folder meanwhile, and the contents are read again once that changes them.
   */
  directoryQuery(directoryId: string) {
    return queryOptions({
      queryFn: async (): Promise<FolderContents> => {
        try {
          return await this.api.listFolder(directoryId);
        } catch (error) {
          return { entries: [], error: String(error), missing: false, read: false };
        }
      },
      queryKey: ['directory', directoryId],
    });
  }

  /** Reads a folder's contents from the catalog, or again if a change or read invalidated it. */
  directory(directoryId: string) {
    return fetchLatest(this.queries, this.directoryQuery(directoryId));
  }

  peekDirectory(directoryId: string) {
    return this.queries.getQueryData(this.directoryQuery(directoryId).queryKey);
  }

  /**
   * The library's folders as the window knows them now, for loaders and event handlers.
   * Components read the tree and the edits with `useKnownFolders` instead.
   */
  private knownFolders(): KnownFolders {
    return { edits: this.edits.getSnapshot(), tree: this.tree.getSnapshot() };
  }

  /** The folder at `id`, with its tile. */
  folder(id: string): PhotoEntry | undefined {
    return folderAt(this.tree.getSnapshot(), id);
  }

  /** The folders from the root down to `id`, or `null` if it is not a known folder. */
  trail(id: string): FolderTrail | null {
    return trailIn(this.root, this.knownFolders(), id);
  }

  /**
   * Has the worker read a folder whose tile is on screen and may still change. It reads in the
   * background, and nothing waits for it: the row changes when the catalog does. Returns the
   * function to call once the tile is off screen, which drops the read if it has not started.
   */
  readTileWhileOnScreen(folderId: string) {
    return this.screenContents.markFolderToRead(folderId);
  }

  originalQuery(entry: PhotoEntry) {
    return this.media.originalQuery(entry);
  }

  peekOpeningStillImage(entryId: string) {
    return this.media.peekOpeningStillImage(entryId);
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
    this.tree.rereadWholeTree();
  }

  /**
   * Brings what the session has read up to date with changes on disk, which the catalog already
   * has. Nothing is patched: whatever a change may have touched is read again from the catalog,
   * and shows as it was until then. Thumbnails and originals of changed files are gone already,
   * because the worker sent their IDs ahead of the changes.
   * - `lost` is true if the open view must be read again instead, which the router does.
   * - `read` settles once the folders on screen and the tree are read again.
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
    this.edits.dropRenamesFrom(changed.flatMap(({ id, entry }) => (entry ? [id] : [])));
    // The contents of what changed and of the folders holding it, however deep, as their tiles
    // may show it, and the subfolders of the folders whose contents changed. Views follow the
    // changes in the worker, which gives them new versions.
    const ids = [...new Set(changed.map(({ id }) => id))];
    const read = Promise.all([
      this.queries.invalidateQueries({
        predicate: ({ queryKey: [kind, folderId] }) =>
          kind === 'directory' && ids.some((id) => isWithin(this.root.id, String(folderId), id)),
      }),
      this.tree.rereadSubfolders(
        changed.filter((change) => change.folderContentsChanged).map(({ parentId }) => parentId),
      ),
    ]);
    return { lost, read };
  }

  /**
   * Renames an entry, which shows at once as a pending edit, until the folders on screen and
   * the tree, read again from the catalog, show it under its new name. `lost` is true if the
   * open view must be read again, as its folder or one holding it was renamed; the edits'
   * renames then lead to it. A failure stays in the edits' `failures` until seen, whatever
   * shows meanwhile.
   */
  rename(entryId: string, name: string) {
    const id = this.edits.currentIdOf(entryId);
    return this.edits.run(id, 'name', name, async (edit) => {
      const result = await this.api.renameEntry(id, name);
      if (result.kind === 'failed') {
        this.edits.failed(entryId, name, result.error);
        return result;
      }
      this.media.forgetContents(findStaleEntryIds(result.changes));
      // The catalog moved what is inside it too, so the tree reads the folders it knew there
      // again under their new IDs, before the trails of an open one inside look for them.
      const tree = this.tree.getSnapshot();
      const moved = [...(folderAt(tree, id) ? [id] : []), ...foldersInside(tree, id)].map(
        (folderId) => movedId(folderId, id, result.entry.id),
      );
      this.edits.renamed(id, edit, result.entry);
      const { lost, read } = this.applyChanges({ changed: result.changes, everything: false });
      await Promise.all([read, this.tree.rereadSubfolders(moved)]);
      return { entry: result.entry, kind: 'renamed' as const, lost };
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
    this.screenContents.close();
    this.views.clear();
    this.media.clear();
    this.queries.clear();
  }
}
