import {
  type FolderRead,
  type IndexOptions,
  type IndexRun,
  isMissing,
} from '#photos/worker/folder-reads';
import { FolderSession } from '#photos/worker/folder-session';
import { isUnchanged } from '#photos/worker/folder-stamps';
import { depthOf, walkFolders } from '#photos/worker/folder-walk';
import { differs, foldersOf } from '#photos/worker/index-writes';
import { readFolder } from '#photos/worker/read-folder';
import type { Scheduler, Want } from '#photos/worker/scheduler';
import type { Catalog, CatalogWrite, FolderStamp, Scope } from '@prism/catalog';
import { errorMessage, type PhotoEntry, type ReadError } from '@prism/shared';
import path from 'node:path';

// Only a folder linked inside itself goes this deep; symbolic links are skipped already.
const MAX_DEPTH = 1024;
// Entries a read hands the catalog at a time, so a large folder shows as it is read.
const WRITE_CHUNK = 256;

export interface IndexerSources {
  /** The canonical path of the folder opened. */
  root: string;
  catalog: Catalog;
  /** Orders every read of the disk. */
  scheduler: Scheduler;
  /** Finds an entry on disk, checking it is inside `root`. */
  resolve: (entryId: string) => Promise<string>;
  /** Stops every read, as the folder closes. */
  signal: AbortSignal;
}

/**
 * Keeps the catalog true to the disk. Each folder is read once a session, breadth first, in the
 * background but for the folder a view opens on and those on show, and only what differs from
 * the catalog is written, so reopening a library the catalog holds is a walk of `readdir` and
 * `stat` calls that writes almost nothing, while its views already show it. The watcher keeps
 * folders read this session current after that.
 */
export class Indexer {
  /** Which folders this session read, is reading, or failed to. */
  private readonly session = new FolderSession();
  private readonly relistedListeners = new Set<(folderId: string) => void>();
  /**
   * The number of the last write of each folder's rows, which the window's reads of the folder
   * wait for, as the catalog's reader sees only what was written.
   */
  private readonly written = new Map<string, number>();

  constructor(private readonly sources: IndexerSources) {
    // A folder whose rows did not reach the catalog is read again when next asked for.
    sources.catalog.onWriteFailed((writes) => this.forget(foldersOf(writes)));
  }

  /**
   * Hears of each folder whose listing a read changed for the window, once written to the
   * catalog: it found other subfolders, read the folder to the end for the first time, or failed.
   */
  onRelisted(listener: (folderId: string) => void): () => void {
    this.relistedListeners.add(listener);
    return () => this.relistedListeners.delete(listener);
  }

  /** Reads the folders of `scope` the catalog may have wrong, until done or `signal` aborts. */
  index(scope: Scope, signal: AbortSignal, options: IndexOptions = {}): IndexRun {
    const progress = { error: null as string | null, errors: [] as ReadError[], finished: false };
    const done = (async () => {
      try {
        await this.walk(scope, signal, options, (folder, read) => {
          progress.errors.push(...read.errors);
          if (folder === scope.directoryId) {
            progress.error = read.error;
          }
        });
      } catch (error) {
        progress.error ??= errorMessage(error);
      } finally {
        progress.finished = true;
      }
    })();
    return Object.assign(progress, { done });
  }

  private async walk(
    scope: Scope,
    signal: AbortSignal,
    { onlyChanged = false }: IndexOptions,
    onRead: (folder: string, read: FolderRead) => void,
  ) {
    const inside = scope.recursive
      ? await this.sources.catalog.call('foldersInside', scope.directoryId)
      : [];
    await walkFolders({
      inside,
      onRead,
      read: async (folder, resolving, wants) =>
        this.session.current.has(folder) ||
        (onlyChanged && (await isUnchanged(this.sources, folder, wants)))
          ? this.readAlready(folder)
          : this.folder(folder, resolving, wants),
      scope,
      signal,
    });
  }

  /**
   * `folderId` as read this session, before the walk got to it, with its subfolders from the
   * catalog: the walk may have started before the read wrote them, as on an empty catalog.
   */
  private async readAlready(folderId: string): Promise<FolderRead> {
    await this.committed(folderId);
    const subfolders = await this.sources.catalog.call('subfolders', [folderId]);
    return { error: null, errors: [], missing: false, subfolders };
  }

  /**
   * Reads `folderId` into the catalog unless it was read this session, settling once its rows
   * are there for the window to read. It was named by the window, so it is resolved on disk,
   * checking it is inside the library. It reads as `wants` says.
   */
  async list(folderId: string, wants: Want): Promise<FolderRead> {
    const read = await this.folder(folderId, true, wants);
    await this.committed(folderId);
    return read;
  }

  /** The failed read of `folderId`, if its last read this session failed. */
  failure(folderId: string): FolderRead | undefined {
    return this.session.failed.get(folderId);
  }

  /** Settles once the rows of `folderId` written so far are in the catalog. */
  private committed(folderId: string) {
    return this.sources.catalog.committed(this.written.get(folderId) ?? 0);
  }

  /** Hands the catalog a write of the rows of `folderId`. */
  private write(folderId: string, write: CatalogWrite) {
    this.written.set(folderId, this.sources.catalog.write(write));
  }

  /**
   * Reads `folderId` unless it was read this session, sharing a read waiting or under way, as
   * the scheduler joins jobs by key, which then goes as the one who wants it most says.
   */
  private folder(folderId: string, resolving: boolean, wants: Want): Promise<FolderRead> {
    if (this.session.current.has(folderId)) {
      // Its subfolders are in the catalog, which the window reads them from.
      return Promise.resolve({ error: null, errors: [], missing: false, subfolders: [] });
    }
    return this.sources.scheduler
      .run('folder', `read ${folderId}`, wants, async () => {
        this.session.reading.add(folderId);
        try {
          return await this.read(folderId, resolving);
        } finally {
          this.session.reading.delete(folderId);
        }
      })
      .catch((error: unknown): FolderRead => {
        const message = errorMessage(error);
        return {
          error: message,
          errors: [{ entryId: folderId, message, path: folderId }],
          missing: false,
          subfolders: [],
        };
      });
  }

  private async read(folderId: string, resolving: boolean): Promise<FolderRead> {
    const { catalog, resolve, root, signal } = this.sources;
    const errors: ReadError[] = [];
    const subfolders: string[] = [];
    const fail = (error: unknown): FolderRead => {
      const message = errorMessage(error);
      // IDs are paths relative to the root, so they say where a folder that fails is.
      errors.push({ entryId: folderId, message, path: folderId });
      const read = { error: message, errors, missing: isMissing(error), subfolders };
      // Told once it fails, or fails otherwise, as the window then lists it again.
      if (this.session.failed.get(folderId)?.error !== message) {
        this.tell(folderId);
      }
      this.session.failed.set(folderId, read);
      this.write(folderId, { stamp: null, stamped: folderId });
      return read;
    };
    if (depthOf(folderId) > MAX_DEPTH) {
      return fail(new Error('Directory nesting exceeds the scan depth limit.'));
    }
    this.session.stale.delete(folderId);
    const [listing, indexed] = await Promise.all([
      catalog.call('listing', folderId),
      catalog.call('isIndexed', folderId),
    ]);
    const known = new Map(listing.map((item) => [item.id, item]));
    const before = new Set(
      [...known.values()].filter((item) => item.kind === 'directory').map((item) => item.id),
    );
    let changed: PhotoEntry[] = [];
    let stamp: FolderStamp | null = null;
    try {
      for await (const item of readFolder(root, folderId, {
        resolve: resolving ? resolve : (id) => Promise.resolve(path.join(root, id)),
        signal,
      })) {
        if ('stamp' in item) {
          ({ stamp } = item);
          continue;
        }
        if ('error' in item) {
          errors.push(item.error);
          continue;
        }
        const { entry } = item;
        if (entry.kind === 'directory') {
          subfolders.push(entry.id);
        }
        if (differs(known.get(entry.id), entry)) {
          changed.push(entry);
          if (changed.length >= WRITE_CHUNK) {
            this.write(folderId, { listed: changed });
            changed = [];
          }
        }
        known.delete(entry.id);
      }
    } catch (error) {
      signal.throwIfAborted();
      if (changed.length > 0) {
        this.write(folderId, { listed: changed });
      }
      return fail(error);
    }
    if (changed.length > 0) {
      this.write(folderId, { listed: changed });
    }
    // A read that saw the folder before it changed again leaves it to the next one.
    const complete = !this.session.stale.has(folderId);
    if (complete) {
      if (known.size > 0) {
        this.write(folderId, { removed: [...known.keys()] });
      }
      this.write(folderId, { indexed: folderId });
      this.write(folderId, { stamp, stamped: folderId });
      this.session.current.add(folderId);
    }
    const wasFailed = this.session.failed.delete(folderId);
    // Other subfolders than the catalog had, `before`: any it did not have, or, once the read
    // is complete, fewer.
    const relisted =
      subfolders.some((id) => !before.has(id)) || (complete && subfolders.length !== before.size);
    if (relisted || wasFailed || (complete && !indexed)) {
      this.tell(folderId);
    }
    return { error: null, errors, missing: false, subfolders };
  }

  /**
   * Tells of `folderId` once its rows are committed, as the window reads its listing and
   * subfolders again from the catalog's reader.
   */
  private tell(folderId: string) {
    this.committed(folderId).then(() => {
      for (const listener of this.relistedListeners) {
        listener(folderId);
      }
    });
  }

  /** Folders to read again, as they changed; every folder if none are given. */
  forget(folderIds?: Iterable<string>): void {
    this.session.forget(folderIds);
  }

  /** Forgets `folderId` and every folder inside it, which went with it. */
  forgetInside(folderId: string): void {
    this.session.forgetInside(folderId);
  }

  /** Notes that the app moved `from` to `to` with its rows; see `FolderSession.moved`. */
  moved(from: string, to: string): void {
    this.session.moved(from, to);
  }
}
