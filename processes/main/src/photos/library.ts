import { Catalog } from '#photos/catalog/client';
import { ChangeTracker, type PathChange } from '#photos/changes';
import { Indexer } from '#photos/indexer';
import { LibraryViews } from '#photos/library-views';
import { mediaKind } from '#photos/media';
import type { ThumbnailSource } from '#photos/thumbnails';
import { isWithin, requireString } from '#photos/validate';
import { inspectFolder } from '#photos/worker/inspection';
import type { FolderChange, FolderListing, FolderSummary, PhotoEntry } from '@prism/shared';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';

/** Makes the catalog a library's folder keeps, in the index `file`. */
export type CatalogFactory = (file: string, root: string) => Catalog;

const idle = () => false;

export class PhotoLibrary {
  readonly controller = new AbortController();
  private readonly tracker: ChangeTracker;
  private readonly indexer: Indexer;
  private readonly catalog: Catalog;
  /** The views the folder's windows have open, as queries of the catalog. */
  readonly views: LibraryViews;
  private busy = idle;
  private constructor(
    readonly root: string,
    indexFile: string,
    connect: CatalogFactory,
  ) {
    const { signal } = this.controller;
    const resolve = (id: string) => this.resolve(id);
    this.catalog = connect(indexFile, root);
    this.tracker = new ChangeTracker(root, (ids) => this.catalog.call('known', ids));
    this.indexer = new Indexer({ catalog: this.catalog, resolve, root, signal });
    this.views = new LibraryViews({
      busy: () => this.busy(),
      catalog: this.catalog,
      indexer: this.indexer,
      resolve,
      root,
      signal,
    });
  }

  /**
   * Opens the folder at `root`, keeping its catalog in the index at `indexFile`; see
   * `prepareIndex`. The app keeps the catalog on a thread of its own; tests keep it on theirs.
   */
  static async open(
    root: string,
    indexFile = ':memory:',
    connect: CatalogFactory = (file, at) => Catalog.inProcess(file, at),
  ): Promise<PhotoLibrary> {
    requireString(root);
    const canonical = await realpath(root);
    const info = await stat(canonical);
    if (!info.isDirectory()) {
      throw new Error('Select a directory.');
    }
    return new PhotoLibrary(canonical, indexFile, connect);
  }

  /** Background reads of photos' details make way for thumbnails while `busy` says so. */
  setBusy(busy: () => boolean): void {
    this.busy = busy;
  }

  async resolve(entryId: string): Promise<string> {
    this.controller.signal.throwIfAborted();
    requireString(entryId);
    const candidate = path.resolve(this.root, entryId);
    if (path.isAbsolute(entryId) || !isWithin(this.root, candidate)) {
      throw new Error('Entry is outside the selected folder.');
    }
    const canonical = await realpath(candidate);
    if (!isWithin(this.root, canonical)) {
      throw new Error('Entry resolves outside the selected folder.');
    }
    this.controller.signal.throwIfAborted();
    return canonical;
  }

  /** A photo or video as it is now, which the watcher then reports any change to. */
  async open(entryId: string): Promise<ThumbnailSource> {
    const file = await this.resolve(entryId);
    const info = await stat(file);
    if (!mediaKind(file) || !info.isFile()) {
      throw new Error('Entry is not a supported photo or video.');
    }
    this.tracker.opened(entryId, info);
    return { file, info };
  }

  async original(entryId: string): Promise<string> {
    return (await this.open(entryId)).file;
  }

  /** The folder's own entries, read into the catalog first if this session has not read it. */
  async listFolder(directoryId: string): Promise<FolderListing> {
    requireString(directoryId);
    this.controller.signal.throwIfAborted();
    const { error, errors } = await this.indexer.list(directoryId);
    // A folder that cannot be read shows nothing, rather than what the catalog last saw of it.
    const entries = error === null ? await this.catalog.call('entriesIn', directoryId) : [];
    return { entries, error, errors };
  }

  inspectFolder(directoryId: string): Promise<FolderSummary> {
    requireString(directoryId);
    this.controller.signal.throwIfAborted();
    return inspectFolder({ catalog: this.catalog, indexer: this.indexer }, directoryId);
  }

  /** The entry at `id` as a read would list it now, or `null` if there is none to list. */
  entryAt(id: string, parentId: string): Promise<PhotoEntry | null> {
    return this.tracker.current(id, parentId);
  }

  /**
   * What the paths the watcher saw are now, leaving out the ones that changed nothing shown,
   * written to the catalog. Folders whose listing changed are read again when next asked for,
   * as are those holding them.
   */
  async describeChanges(changes: PathChange[]): Promise<FolderChange[]> {
    const described = await this.tracker.describe(changes);
    const changed = new Set<string>();
    for (const { parentId } of described.filter((change) => change.listingChanged)) {
      for (let id = parentId; !changed.has(id); id = path.dirname(id)) {
        changed.add(id);
      }
    }
    this.views.forget([...changed]);
    this.views.apply(described);
    return described;
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
    await this.catalog.close();
  }
}
