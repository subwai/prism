import { isWithin, requireString, requireTrashChoices, requireViewRange } from '#photos/validate';
import {
  changedFolders,
  describe,
  entryOnDisk,
  noteRead,
  noteRewritten,
  observe,
  type PathChange,
  type ReadFiles,
  updateRead,
} from '#photos/worker/changes';
import type { FolderRead } from '#photos/worker/folder-reads';
import { Indexer } from '#photos/worker/indexer';
import { LibraryViews } from '#photos/worker/library-views';
import { Scheduler, VISIBLE, type Want } from '#photos/worker/scheduler';
import { readTile } from '#photos/worker/tile-reads';
import { Catalog, type CatalogFiles, type ReadDetails, type ViewFiles } from '@prism/catalog';
import { closeExifTool, type ListedFile, mediaKind, type ThumbnailSource } from '@prism/media';
import {
  type FolderChange,
  type FolderListing,
  type FolderSkeleton,
  type PhotoEntry,
  plansTrash,
  type Rating,
  type TrashChoices,
  type TrashFiles,
  type TrashPlan,
} from '@prism/shared';
import type { Stats } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
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
  private readonly catalog: Catalog;
  /** The views the folder's windows have open, as queries of the catalog. */
  readonly views: LibraryViews;
  /** Orders every read of the disk the library makes, and the window asks for. */
  readonly scheduler = new Scheduler(this.signal);

  private constructor(
    /** The folder's canonical path. */
    readonly root: string,
    files: CatalogFiles,
    connect: CatalogFactory,
  ) {
    const { signal } = this;
    const resolve = (id: string) => this.resolve(id);
    this.catalog = connect(files, root);
    const { scheduler } = this;
    this.indexer = new Indexer({ catalog: this.catalog, resolve, root, scheduler, signal });
    this.views = new LibraryViews({
      catalog: this.catalog,
      indexer: this.indexer,
      root,
      scheduler,
      signal,
    });
  }

  /**
   * Opens the folder at `root`, a canonical path, keeping its catalog in `files`; see
   * `prepareIndex` and `prepareRatings`. The app keeps the catalog on a thread of its own; tests
   * keep it on theirs. Nothing asks the disk, so a slow or offline share opens from its catalog.
   */
  static open(
    root: string,
    files = IN_MEMORY,
    connect: CatalogFactory = Catalog.inProcess,
  ): PhotoLibrary {
    requireString(root);
    return new PhotoLibrary(root, files, connect);
  }

  /**
   * Reads every folder the catalog knows, and those found inside them, once this session, in
   * the background, so the catalog catches up with what changed while the library was closed,
   * folders gone included. Views share its reads, and it stops as the library closes. Settles
   * once every folder is read.
   */
  checkEveryFolder(): Promise<unknown> {
    return this.indexer.index({ directoryId: '.', recursive: true }, this.signal).done;
  }

  /** Hears of folders whose subfolders, as reads found them, or their tiles, changed. */
  onRelisted(listener: (folderIds: string[]) => void): () => void {
    const stopReads = this.indexer.onRelisted((folderId) => listener([folderId]));
    const stopTiles = this.catalog.onTilesChanged(listener);
    return () => {
      stopReads();
      stopTiles();
    };
  }

  /** Finds an entry on disk, checking it is inside the folder, even after following links. */
  async resolve(entryId: string): Promise<string> {
    this.signal.throwIfAborted();
    requireString(entryId);
    const candidate = path.resolve(this.root, entryId);
    if (path.isAbsolute(entryId) || !isWithin(this.root, candidate)) {
      throw new Error('Entry is outside the selected folder.');
    }
    const canonical = await realpath(candidate);
    if (!isWithin(this.root, canonical)) {
      throw new Error('Entry resolves outside the selected folder.');
    }
    this.signal.throwIfAborted();
    return canonical;
  }

  /** A photo or video as it is now, which the watcher then reports any change to. */
  async open(entryId: string): Promise<ThumbnailSource> {
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

  /**
   * The folders the catalog knows directly inside each of `parentIds`, as it has them now,
   * without waiting for any to be read.
   */
  folderSkeleton(parentIds: string[]): Promise<FolderSkeleton> {
    this.signal.throwIfAborted();
    return this.catalog.call('folderSkeleton', parentIds);
  }

  /** Every folder the catalog knows, as JSON, without waiting for any to be read. */
  wholeSkeleton(): Promise<string> {
    this.signal.throwIfAborted();
    return this.catalog.call('wholeSkeleton');
  }

  /**
   * What moving the entries a view shows to the Trash would move; see `CatalogViews.trashPlan`.
   * Only a view of everything inside a folder, folders included, has one.
   */
  trashPlan(viewId: string, version: number, choices: TrashChoices): Promise<TrashPlan | null> {
    this.requirePlan(viewId, version, choices);
    return this.catalog.call('viewTrashPlan', viewId, version, choices);
  }

  /** Every entry that plan would move, one by one; see `CatalogViews.trashFiles`. */
  trashFiles(viewId: string, version: number, choices: TrashChoices): Promise<TrashFiles | null> {
    this.requirePlan(viewId, version, choices);
    return this.catalog.call('viewTrashFiles', viewId, version, choices);
  }

  private requirePlan(viewId: string, version: number, choices: TrashChoices) {
    requireString(viewId);
    requireViewRange(version, 0, 0);
    requireTrashChoices(choices);
    if (!plansTrash(this.views.specOf(viewId))) {
      throw new Error('Only a view of everything inside a folder can be moved to the Trash.');
    }
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
  async describeChanges(changes: PathChange[]): Promise<FolderChange[]> {
    // Compared with every write so far, such as a rewrite's, which then changes nothing.
    await this.catalog.committed();
    const observed = await observe(this.root, changes, this.read, (ids) =>
      this.catalog.call('known', ids),
    );
    const described = describe(observed);
    updateRead(this.read, described);
    this.views.forget(changedFolders(described));
    this.views.apply(described);
    return this.catalog.committed().then(() => described);
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
  }

  async close(): Promise<void> {
    this.controller.abort();
    this.views.closeAll();
    await Promise.all([this.catalog.close(), closeExifTool()]);
  }
}
