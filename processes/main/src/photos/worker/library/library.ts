import { requireString, resolveIn } from '#photos/validate';
import type { PathChange } from '#photos/worker/changes/describe-changes';
import { LibraryChanges } from '#photos/worker/changes/library-changes';
import {
  type ContentInfo,
  noteRewritten,
  noteShown,
  type ShownFiles,
} from '#photos/worker/changes/shown-files';
import { entryOnDisk } from '#photos/worker/disk/entry-on-disk';
import { lookAtMediaFile } from '#photos/worker/disk/media-file';
import { createShareCheck, Share } from '#photos/worker/disk/share/share';
import type { FolderRead } from '#photos/worker/indexer/index-run';
import { Indexer } from '#photos/worker/indexer/indexer';
import { libraryChecks } from '#photos/worker/indexer/library-checks';
import { libraryActivity } from '#photos/worker/library/activity';
import { IN_MEMORY, type LibraryOptions } from '#photos/worker/library/library-options';
import { readTile } from '#photos/worker/on-screen/read-tile';
import {
  ALWAYS_VISIBLE,
  type CurrentPriority,
  Scheduler,
} from '#photos/worker/scheduler/scheduler';
import { trashPlans } from '#photos/worker/trash/view-trash-plans';
import { LibraryViews } from '#photos/worker/views/library-views';
import { Catalog, type ReadDetails, type ViewFileRange } from '@prism/catalog';
import { closeExifTool, type ListedFile, mediaKind, type ThumbnailSource } from '@prism/media';
import type {
  FolderChange,
  FolderContents,
  PhotoEntry,
  Rating,
  SerializedTreeListing,
} from '@prism/shared';
import path from 'node:path';

// A file's inode is its number on its disk, which a rename or move keeps.

/** A folder opened as a library: its catalog, the views of it, and what changes inside it. */
export class PhotoLibrary {
  private readonly controller = new AbortController();
  /** Aborts as the library closes. */
  readonly signal = this.controller.signal;
  /** Files whose contents the window was shown, so a change to one is shown again. */
  private readonly shownFiles: ShownFiles = new Map();
  private readonly indexer: Indexer;
  private readonly changes: LibraryChanges;
  private readonly catalog: Catalog;
  /** The views the folder's windows have open, as queries of the catalog. */
  readonly views: LibraryViews;
  /** Orders every disk read, the library's and the window's; waits while the share is offline. */
  readonly scheduler = new Scheduler(this.signal, (error) => this.share.failedOffline(error));
  /** Each launch's check of every folder, and full reads of every folder; see `libraryChecks`. */
  readonly checkEveryFolder: () => Promise<unknown>;
  readonly readEveryFolder: () => Promise<void>;
  /** What the library is busy with, which the status bar shows; see `libraryActivity`. */
  readonly activity: ReturnType<typeof libraryActivity>;
  /** What moving what a view shows to the Trash would move; see `trashPlans`. */
  readonly trashPlans: ReturnType<typeof trashPlans>;

  /** Whether the folder can be reached, or its volume, such as a share, is offline. */
  readonly share: Share;

  private constructor(
    /** The folder's canonical path. */
    readonly root: string,
    { files, connect, now, share }: Required<LibraryOptions>,
  ) {
    this.share = share;
    const { signal } = this;
    const resolve = (id: string) => this.resolve(id);
    this.catalog = connect(files, root);
    const { catalog, scheduler } = this;
    this.indexer = new Indexer({ catalog, now, resolve, root, scheduler, share, signal });
    const { indexer, shownFiles } = this;
    this.views = new LibraryViews({ catalog, indexer, root, scheduler, share, signal });
    const checks = libraryChecks({ catalog, indexer, now, signal });
    this.checkEveryFolder = checks.checkEveryFolder;
    this.readEveryFolder = checks.readEveryFolder;
    this.changes = new LibraryChanges({
      catalog,
      indexer,
      root,
      share,
      shownFiles,
      signal,
      views: this.views,
    });
    this.activity = libraryActivity({
      catalog,
      checks,
      scheduler,
      share,
      walks: indexer.walks,
    });
    this.trashPlans = trashPlans(catalog, this.views);
    // Changes made while the share was offline went unseen, so its return starts a launch's check.
    share.onChange((state) => {
      scheduler.setPaused(state === 'offline');
      if (state === 'online') {
        this.checkEveryFolder().catch(() => null);
      }
    });
  }

  /**
   * Opens the folder at `root`, a canonical path; see `LibraryOptions`. Nothing here touches the
   * disk, so a slow or offline share opens from its catalog.
   */
  static open(root: string, options: LibraryOptions = {}): PhotoLibrary {
    requireString(root);
    return new PhotoLibrary(root, {
      connect: options.connect ?? Catalog.inProcess,
      files: options.files ?? IN_MEMORY,
      now: options.now ?? Date.now,
      share: options.share ?? new Share(createShareCheck(root)),
    });
  }

  /** Calls `listener` with folders whose subfolders or tiles changed, as reads or the catalog found. */
  /** Hears that a forget of every photo's details is done; see `Catalog.onDetailsForgotten`. */
  onDetailsForgotten(listener: () => void): () => void {
    return this.catalog.onDetailsForgotten(listener);
  }

  onFoldersChanged(listener: Parameters<Catalog['onFoldersChanged']>[0]): () => void {
    const stops = [
      this.indexer.onContentsChanged((folderId) => listener({ folders: [folderId], tiles: [] })),
      this.catalog.onFoldersChanged(listener),
    ];
    return () => stops.map((stop) => stop());
  }

  /** Finds an entry on disk, checking it is inside the folder, even after following links. */
  async resolve(entryId: string): Promise<string> {
    this.signal.throwIfAborted();
    const canonical = await resolveIn(this.root, entryId);
    this.signal.throwIfAborted();
    return canonical;
  }

  /** Finds `entryId` on disk now, and notes it as shown, so the watcher reports changes. */
  async openMediaFile(entryId: string): Promise<ThumbnailSource> {
    this.share.throwIfOffline();
    const source = await lookAtMediaFile(await this.resolve(entryId));
    noteShown(this.shownFiles, entryId, source.info);
    return source;
  }

  /**
   * A photo or video as the catalog last listed it, without looking at the disk, which on a
   * network share is the slow part of finding a thumbnail. `null` if the catalog has not listed it
   * since it started keeping inodes; then a look at the disk is needed. Its thumbnail is as good
   * as shown, so it is noted as shown and the watcher reports a change to it.
   */
  async listedFile(entryId: string): Promise<ListedFile | null> {
    requireString(entryId);
    this.signal.throwIfAborted();
    const [known] = await this.catalog.call('catalogEntriesAt', [entryId]);
    if (!known || !mediaKind(entryId) || known.kind === 'directory') {
      return null;
    }
    const { inode, modifiedMs, size } = known;
    if (inode === null || modifiedMs === null || size === null) {
      return null;
    }
    noteShown(this.shownFiles, entryId, { mtimeMs: modifiedMs, size });
    // IDs are paths inside the canonical root, as folders list them, and links are not listed.
    return { file: path.join(this.root, entryId), inode, modifiedMs, size };
  }

  async original(entryId: string): Promise<string> {
    return (await this.openMediaFile(entryId)).file;
  }

  /**
   * The folder's own entries as the catalog has them, at once, with whether the catalog has read
   * the folder to the end, or why the last read of it this session failed. Unless this session
   * read it or failed to, it is read in the background, and the window is sent what that changes.
   */
  async listFolder(directoryId: string): Promise<FolderContents> {
    requireString(directoryId);
    this.signal.throwIfAborted();
    const failed = this.indexer.failedRead(directoryId);
    // Shows nothing, instead of what the catalog last saw. It is read again once forgotten, or by a view.
    if (failed) {
      return { entries: [], error: failed.error, missing: failed.missing, read: false };
    }
    this.readFolder(directoryId).catch(() => null);
    const [entries, read] = await Promise.all([
      this.catalog.call('entriesIn', directoryId),
      this.catalog.call('isIndexed', directoryId),
    ]);
    return { entries, error: null, missing: false, read };
  }

  /** Reads `directoryId` into the catalog unless this session did, at visible priority; see `Indexer.readIntoCatalog`. */
  readFolder(directoryId: string): Promise<FolderRead> {
    return this.indexer.readIntoCatalog(directoryId, ALWAYS_VISIBLE);
  }

  /** The folders the catalog knows inside each of `parentIds`, without waiting for any read. */
  listSubfolders(parentIds: string[]): Promise<SerializedTreeListing> {
    this.signal.throwIfAborted();
    return this.catalog.call('listSubfolders', parentIds);
  }

  /** The folders at `folderIds` as the catalog has them now, for when their tiles changed. */
  listFoldersById(folderIds: string[]): Promise<SerializedTreeListing> {
    this.signal.throwIfAborted();
    return this.catalog.call('listFoldersById', folderIds);
  }

  /** Every folder the catalog knows, as JSON, without waiting for any to be read. */
  listWholeTree(): Promise<string> {
    this.signal.throwIfAborted();
    return this.catalog.listWholeTree();
  }

  /** Reads into the catalog what the tile of `directoryId` shows at `priority`; see `readTile`. */
  readTile(directoryId: string, priority: CurrentPriority): Promise<void> {
    this.signal.throwIfAborted();
    return readTile({ catalog: this.catalog, indexer: this.indexer, priority }, directoryId);
  }

  /** Entries of a view as listed, with folders' covers; see `CatalogViews.files`. */
  viewFiles(
    viewId: string,
    start: number,
    end: number,
    limit: number,
  ): Promise<ViewFileRange | null> {
    return this.catalog.call('viewFiles', viewId, start, end, limit);
  }

  /** The entry at `id` as a read would list it now, or `null` if there is none to list. */
  entryAt(id: string, parentId: string): Promise<PhotoEntry | null> {
    return entryOnDisk(this.root, id, parentId);
  }

  /**
   * Looks at what the paths the watcher saw are now, and writes the changes to the catalog; see
   * `LibraryChanges.describe`. Paths that changed nothing shown are left out.
   */
  describeChanges(changes: PathChange[]): Promise<FolderChange[]> {
    return this.changes.describe(changes);
  }

  /**
   * Notes that the file of `entryId` was rewritten without changing what it shows, and stores it
   * as listed now, with the details read from it. The watcher's report of the rewrite then
   * changes nothing, so its thumbnail and original are not read again.
   */
  storeRewrite(entry: PhotoEntry, info: ContentInfo, read: ReadDetails): void {
    noteRewritten(this.shownFiles, entry.id, info);
    this.catalog.write({ entries: [entry], kind: 'list' });
    this.catalog.write({ details: [read], kind: 'storeDetails' });
    this.catalog.flush();
  }

  /** Keeps the rating of an entry with no file of its own to keep it in; see `keepsRatingInFile`. */
  keepRating(entryId: string, rating: Rating | null): Promise<void> {
    return this.catalog.call('rate', entryId, rating);
  }

  /** Moves an entry on disk, and its rows in the catalog with it; see `LibraryChanges.move`. */
  move(
    from: string,
    to: string,
    onDisk: () => Promise<PhotoEntry | null>,
  ): Promise<{ entry: PhotoEntry; changes: FolderChange[] } | null> {
    return this.changes.move(from, to, onDisk);
  }

  /** Moves the ratings kept of `from`, and everything inside it, as it is renamed `to`. */
  moveRatings(from: string, to: string): Promise<void> {
    return this.catalog.call('moveRatings', from, to);
  }

  /**
   * Marks the folders that changed on disk, or every folder, to be read again when next asked
   * for; see `LibraryViews.forget`.
   */
  forget(directoryIds?: Iterable<string>): void {
    this.views.forget(directoryIds && [...directoryIds]);
    if (!directoryIds) {
      // Another library's writer may have forgotten every photo's details, which this writer's
      // count of them doesn't hear, so a refresh counts them again.
      this.catalog.call('countDetails').catch(() => null);
    }
  }

  async close(): Promise<void> {
    this.controller.abort();
    this.views.closeAll();
    await Promise.all([this.catalog.close(), closeExifTool()]);
  }
}
