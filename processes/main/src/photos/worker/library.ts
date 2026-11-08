import { type Catalog, inProcessCatalog } from '#photos/catalog/client';
import { mediaKind } from '#photos/media/media';
import type { ThumbnailSource } from '#photos/media/thumbnails';
import { isWithin, requireString } from '#photos/validate';
import { createChangeTracker, entryOnDisk, type PathChange } from '#photos/worker/changes';
import { createIndexer } from '#photos/worker/indexer';
import { inspectFolder } from '#photos/worker/inspection';
import { createLibraryViews, type LibraryViews } from '#photos/worker/library-views';
import type { FolderChange, FolderListing, FolderSummary, PhotoEntry } from '@prism/shared';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';

/** Makes the catalog a library's folder keeps, in the index `file`. */
export type CatalogFactory = (file: string, root: string) => Catalog;

/** A folder opened as a library: its catalog, the views of it, and what changes inside it. */
export interface PhotoLibrary {
  /** The folder's canonical path. */
  root: string;
  /** Aborts as the library closes. */
  signal: AbortSignal;
  /** The views the folder's windows have open, as queries of the catalog. */
  views: LibraryViews;
  /** Background reads of photos' details make way for thumbnails while `busy` says so. */
  setBusy: (busy: () => boolean) => void;
  /** Finds an entry on disk, checking it is inside the folder. */
  resolve: (entryId: string) => Promise<string>;
  /** A photo or video as it is now, which the watcher then reports any change to. */
  open: (entryId: string) => Promise<ThumbnailSource>;
  original: (entryId: string) => Promise<string>;
  /** The folder's own entries, read into the catalog first if this session has not read it. */
  listFolder: (directoryId: string) => Promise<FolderListing>;
  inspectFolder: (directoryId: string) => Promise<FolderSummary>;
  /** The entry at `id` as a read would list it now, or `null` if there is none to list. */
  entryAt: (id: string, parentId: string) => Promise<PhotoEntry | null>;
  /**
   * What the paths the watcher saw are now, leaving out the ones that changed nothing shown,
   * written to the catalog. Folders whose listing changed are read again when next asked for,
   * as are those holding them.
   */
  describeChanges: (changes: PathChange[]) => Promise<FolderChange[]>;
  /**
   * Has folders that changed on disk read again when next asked for, or every folder. Without
   * folders, every open view reads its folders again; the catalog shows them meanwhile.
   */
  forget: (directoryIds?: Iterable<string>) => void;
  close: () => Promise<void>;
}

/** The entry at `entryId` inside `root`, checking it is there, even after following links. */
async function resolveIn(root: string, entryId: string, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  requireString(entryId);
  const candidate = path.resolve(root, entryId);
  if (path.isAbsolute(entryId) || !isWithin(root, candidate)) {
    throw new Error('Entry is outside the selected folder.');
  }
  const canonical = await realpath(candidate);
  if (!isWithin(root, canonical)) {
    throw new Error('Entry resolves outside the selected folder.');
  }
  signal.throwIfAborted();
  return canonical;
}

/** The folders holding each change that altered a listing, up to the library's own. */
function changedFolders(described: FolderChange[]): string[] {
  const changed = new Set<string>();
  for (const { parentId } of described.filter((change) => change.listingChanged)) {
    for (let id = parentId; !changed.has(id); id = path.dirname(id)) {
      changed.add(id);
    }
  }
  return [...changed];
}

const idle = () => false;

function createLibrary(root: string, indexFile: string, connect: CatalogFactory): PhotoLibrary {
  const controller = new AbortController();
  const { signal } = controller;
  const resolve = (entryId: string) => resolveIn(root, entryId, signal);
  const catalog = connect(indexFile, root);
  const tracker = createChangeTracker(root, (ids) => catalog.call('known', ids));
  const indexer = createIndexer({ catalog, resolve, root, signal });
  let busy = idle;
  const views = createLibraryViews({ busy: () => busy(), catalog, indexer, resolve, root, signal });

  async function open(entryId: string): Promise<ThumbnailSource> {
    const file = await resolve(entryId);
    const info = await stat(file);
    if (!mediaKind(file) || !info.isFile()) {
      throw new Error('Entry is not a supported photo or video.');
    }
    tracker.opened(entryId, info);
    return { file, info };
  }

  return {
    async close() {
      controller.abort();
      views.closeAll();
      await catalog.close();
    },
    async describeChanges(changes) {
      const described = await tracker.describe(changes);
      views.forget(changedFolders(described));
      views.apply(described);
      return described;
    },
    entryAt: (id, parentId) => entryOnDisk(root, id, parentId),
    forget(directoryIds) {
      views.forget(directoryIds && [...directoryIds]);
    },
    inspectFolder(directoryId) {
      requireString(directoryId);
      signal.throwIfAborted();
      return inspectFolder({ catalog, indexer }, directoryId);
    },
    async listFolder(directoryId) {
      requireString(directoryId);
      signal.throwIfAborted();
      const { error, errors } = await indexer.list(directoryId);
      // A folder that cannot be read shows nothing, rather than what the catalog last saw of it.
      const entries = error === null ? await catalog.call('entriesIn', directoryId) : [];
      return { entries, error, errors };
    },
    open,
    original: async (entryId) => (await open(entryId)).file,
    resolve,
    root,
    setBusy(next) {
      busy = next;
    },
    signal,
    views,
  };
}

/**
 * Opens the folder at `root`, keeping its catalog in the index at `indexFile`; see
 * `prepareIndex`. The app keeps the catalog on a thread of its own; tests keep it on theirs.
 */
export async function openLibrary(
  root: string,
  indexFile = ':memory:',
  connect: CatalogFactory = inProcessCatalog,
): Promise<PhotoLibrary> {
  requireString(root);
  const canonical = await realpath(root);
  const info = await stat(canonical);
  if (!info.isDirectory()) {
    throw new Error('Select a directory.');
  }
  return createLibrary(canonical, indexFile, connect);
}
