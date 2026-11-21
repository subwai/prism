import { requireString, resolveIn } from '#photos/validate';
import { libraryActivity } from '#photos/worker/activity';
import {
  entryOnDisk,
  noteRead,
  noteRewritten,
  type PathChange,
  type ReadFiles,
} from '#photos/worker/changes';
import type { FolderRead } from '#photos/worker/folder-reads';
import { Indexer } from '#photos/worker/indexer';
import { LibraryChanges } from '#photos/worker/library-changes';
import { libraryChecks } from '#photos/worker/library-checks';
import { LibraryViews } from '#photos/worker/library-views';
import { Scheduler, VISIBLE, type Want } from '#photos/worker/scheduler';
import { probeOf, Share } from '#photos/worker/share';
import { ShareOfflineError } from '#photos/worker/share-offline-error';
import { readTile } from '#photos/worker/tile-reads';
import { trashPlans } from '#photos/worker/trash-plans';
import { Catalog, type CatalogFiles, type ReadDetails, type ViewFiles } from '@prism/catalog';
import { closeExifTool, type ListedFile, mediaKind, type ThumbnailSource } from '@prism/media';
import type {
  FolderChange,
  FolderListing,
  FolderSkeleton,
  PhotoEntry,
  Rating,
} from '@prism/shared';
import type { Stats } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';

/** Makes the catalog a library's folder keeps, in `files`. */
export type CatalogFactory = (files: CatalogFiles, root: string) => Catalog;

/** Files kept for this session only, as tests keep them. */
const IN_MEMORY: CatalogFiles = { index: ':memory:', ratings: ':memory:' };

/** A folder opened as a library: its catalog, the views of it, and what changes inside it. */
export class PhotoLibrary {
  private readonly controller = new AbortController();
  /** Aborts as the library closes. */
  readonly signal = this.controller.signal;
  /** Files whose contents the window was shown, which a change then shows again. */
  private readonly read: ReadFiles = new Map();
  private readonly indexer: Indexer;
  private readonly changes: LibraryChanges;
  private readonly catalog: Catalog;
  /** The views the folder's windows have open, as queries of the catalog. */
  readonly views: LibraryViews;
  /**
   * Orders every read of the disk the library makes, and the window asks for, which waits while
   * the share is offline.
   */
  readonly scheduler = new Scheduler(this.signal, (error) => this.share.lost(error));
  /** Each launch's check of every folder, and full reads of them; see `libraryChecks`. */
  readonly checkEveryFolder: () => Promise<unknown>;
  readonly readEveryFolder: () => Promise<void>;
  /** What the library is busy with, which the status bar shows; see `libraryActivity`. */
  readonly activity: ReturnType<typeof libraryActivity>;
  /** What moving what a view shows to the Trash would move; see `trashPlans`. */
  readonly trashPlans: ReturnType<typeof trashPlans>;

  private constructor(
    /** The folder's canonical path. */
    readonly root: string,
    files: CatalogFiles,
    connect: CatalogFactory,
    now: () => number,
    /** Whether the folder can be reached, or its volume, such as a share, is offline. */
    readonly share: Share,
  ) {
    const { signal } = this;
    const resolve = (id: string) => this.resolve(id);
    this.catalog = connect(files, root);
    const { catalog, scheduler } = this;
    this.indexer = new Indexer({ catalog, now, resolve, root, scheduler, share, signal });
    const { indexer, read } = this;
    this.views = new LibraryViews({ catalog, indexer, root, scheduler, signal });
    const checks = libraryChecks({ catalog, indexer, now, signal });
    this.checkEveryFolder = checks.checkEveryFolder;
    this.readEveryFolder = checks.readEveryFolder;
    this.changes = new LibraryChanges({ catalog, indexer, read, root, share, views: this.views });
    this.activity = libraryActivity({ catalog, scheduler, walks: indexer.walks });
    this.trashPlans = trashPlans(catalog, this.views);
    // What changed while the share was offline went unseen, so each return is a launch's check.
    share.onChange((reach) => {
      scheduler.pause(reach === 'offline');
      if (reach === 'online') {
        this.checkEveryFolder().catch(() => null);
      }
    });
  }

  /**
   * Opens the folder at `root`, a canonical path, keeping its catalog in `files`; see
   * `prepareIndex` and `prepareRatings`. The app keeps the catalog on a thread of its own; tests
   * keep it on theirs. Nothing asks the disk, so a slow or offline share opens from its catalog.
   * `now` tells the time, and `share` how the folder can be reached, which tests set.
   */
  static open(
    root: string,
    files = IN_MEMORY,
    connect: CatalogFactory = Catalog.inProcess,
    now: () => number = Date.now,
    share = new Share(probeOf(root)),
  ): PhotoLibrary {
    requireString(root);
    return new PhotoLibrary(root, files, connect, now, share);
  }

  /** Hears of folders whose subfolders changed, as reads or the catalog found, or tiles did. */
  onFoldersChanged(listener: Parameters<Catalog['onFoldersChanged']>[0]): () => void {
    const stops = [
      this.indexer.onRelisted((folderId) => listener({ folders: [folderId], tiles: [] })),
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

  /** A photo or video as it is now, which the watcher then reports any change to. */
  async open(entryId: string): Promise<ThumbnailSource> {
    // A share mounted but unreachable takes a minute to fail each look.
    if (this.share.reach === 'offline') {
      throw new ShareOfflineError();
    }
    const file = await this.resolve(entryId);
    const info = await stat(file);
    if (!mediaKind(file) || !info.isFile()) {
      throw new Error('Entry is not a supported photo or video.');
    }
    noteRead(this.read, entryId, info);
    return { file, info };
  }

  /**
   * A photo or video as the catalog last listed it, with no look at the disk, which on a
   * network share is the slow part of finding a thumbnail. `null` if the catalog has not
   * listed it since it kept inodes, which a look at the disk then answers. Its thumbnail is as
   * good as read, so the watcher reports a change to it.
   */
  async listed(entryId: string): Promise<ListedFile | null> {
    requireString(entryId);
    this.signal.throwIfAborted();
    const [known] = await this.catalog.call('known', [entryId]);
    if (!known || !mediaKind(entryId) || known.kind === 'directory') {
      return null;
    }
    const { inode, modifiedMs, size } = known;
    if (inode === null || modifiedMs === null || size === null) {
      return null;
    }
    noteRead(this.read, entryId, { mtimeMs: modifiedMs, size });
    // IDs are paths inside the canonical root, as folders list them, and links are not listed.
    return { file: path.join(this.root, entryId), inode, modifiedMs, size };
  }

  async original(entryId: string): Promise<string> {
    return (await this.open(entryId)).file;
  }

  /**
   * The folder's own entries as the catalog has them, at once, and whether it has read the folder
   * to the end, or why the last read of it this session failed. Unless this session read it, or
   * failed to, it is read in the background, and the window hears of what that changes.
   */
  async listFolder(directoryId: string): Promise<FolderListing> {
    requireString(directoryId);
    this.signal.throwIfAborted();
    const failed = this.indexer.failure(directoryId);
    // Shows nothing, rather than what the catalog last saw; read again once forgotten, or by a view.
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

  /** Reads `directoryId` into the catalog unless this session did, as on show; see `list`. */
  readFolder(directoryId: string): Promise<FolderRead> {
    return this.indexer.list(directoryId, VISIBLE);
  }

  /** The folders the catalog knows inside each of `parentIds`, without waiting for any read. */
  folderSkeleton(parentIds: string[]): Promise<FolderSkeleton> {
    this.signal.throwIfAborted();
    return this.catalog.call('folderSkeleton', parentIds);
  }

  /** The folders at `folderIds` as the catalog has them now, as their tiles changed. */
  folderTiles(folderIds: string[]): Promise<FolderSkeleton> {
    this.signal.throwIfAborted();
    return this.catalog.call('folderTiles', folderIds);
  }

  /** Every folder the catalog knows, as JSON, without waiting for any to be read. */
  wholeSkeleton(): Promise<string> {
    this.signal.throwIfAborted();
    return this.catalog.wholeSkeleton();
  }

  /** Reads into the catalog what the tile of `directoryId` shows, as `wants` says; see `readTile`. */
  readTile(directoryId: string, wants: Want): Promise<void> {
    this.signal.throwIfAborted();
    return readTile({ catalog: this.catalog, indexer: this.indexer, wants }, directoryId);
  }

  /** Entries of a view as listed, with folders' covers; see `CatalogViews.files`. */
  viewFiles(viewId: string, start: number, end: number, limit: number): Promise<ViewFiles | null> {
    return this.catalog.call('viewFiles', viewId, start, end, limit);
  }

  /** The entry at `id` as a read would list it now, or `null` if there is none to list. */
  entryAt(id: string, parentId: string): Promise<PhotoEntry | null> {
    return entryOnDisk(this.root, id, parentId);
  }

  /**
   * What the paths the watcher saw are now, leaving out the ones that changed nothing shown,
   * written to the catalog, settling once it has them. Folders whose listing changed are read
   * again when next asked for, as are those holding them.
   */
  describeChanges(changes: PathChange[]): Promise<FolderChange[]> {
    return this.changes.describe(changes);
  }

  /**
   * Notes that the file of `entryId` was rewritten without changing what it shows, and stores
   * it as listed now, with the details read from it then. The watcher's report of the rewrite
   * then changes nothing, so its thumbnail and original are not read again.
   */
  storeRewrite(entry: PhotoEntry, info: Stats, read: ReadDetails): void {
    noteRewritten(this.read, entry.id, info);
    this.catalog.write({ listed: [entry] });
    this.catalog.write({ details: [read] });
    this.catalog.flush();
  }

  /** Keeps the rating of an entry with no file of its own to keep it in; see `ratesInFile`. */
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
   * Has folders that changed on disk read again when next asked for, or every folder. Without
   * folders, every open view reads its folders again; the catalog shows them meanwhile.
   */
  forget(directoryIds?: Iterable<string>): void {
    this.views.forget(directoryIds && [...directoryIds]);
    if (!directoryIds) {
      // Forgetting every photo's details, which another thread does, ends in a refresh.
      this.catalog.call('countDetails').catch(() => null);
    }
  }

  async close(): Promise<void> {
    this.controller.abort();
    this.views.closeAll();
    await Promise.all([this.catalog.close(), closeExifTool()]);
  }
}
