import { readFolder } from '#photos/worker/read-folder';
import type { Catalog, CatalogWrite, KnownItem, Scope } from '@prism/catalog';
import { errorMessage, type PhotoEntry, type ReadError } from '@prism/shared';
import path from 'node:path';
import pLimit from 'p-limit';

// Folders read at once, across every view. A network share answers many at once about as fast
// as one, while a local disk gains little past a few.
const READ_AHEAD = 16;
// Only a folder linked inside itself goes this deep; symbolic links are skipped already.
const MAX_DEPTH = 1024;
// Entries a read hands the catalog at a time, so a large folder shows as it is read.
const WRITE_CHUNK = 256;

/** A view's read of the folders it shows, as it goes. */
export interface IndexRun {
  /**
   * Settles once the scope's own folder has been read, with its rows in the catalog, or could
   * not be.
   */
  first: Promise<unknown>;
  /** Settles once every folder of the scope has been read. */
  done: Promise<unknown>;
  finished: boolean;
  errors: ReadError[];
  /** Why the scope's own folder could not be read. */
  error: string | null;
}

/** A read of one folder: what could not be read, and the folders found inside it. */
export interface FolderRead {
  subfolders: string[];
  errors: ReadError[];
  error: string | null;
}

export interface IndexerSources {
  /** The canonical path of the folder opened. */
  root: string;
  catalog: Catalog;
  /** Finds an entry on disk, checking it is inside `root`. */
  resolve: (entryId: string) => Promise<string>;
  /** Stops every read, as the folder closes. */
  signal: AbortSignal;
}

function depthOf(id: string) {
  return id === '.' ? 0 : id.split(path.sep).length;
}

/**
 * Whether a listing of an entry says something other than what the catalog knows of it. Its
 * inode counts, so a catalog from before it kept them learns each as its folder is read.
 */
function differs(known: KnownItem | undefined, entry: PhotoEntry) {
  return (
    known?.kind !== entry.kind ||
    known.size !== (entry.metadata?.size ?? null) ||
    known.modifiedMs !== (entry.metadata?.modifiedMs ?? null) ||
    known.inode !== (entry.metadata?.inode ?? null)
  );
}

/** The folders whose rows `writes` would have changed, which must be read again if they failed. */
function foldersOf(writes: CatalogWrite[]): string[] {
  return writes.flatMap((write) => {
    if ('listed' in write) {
      return write.listed.map((entry) => entry.parentId);
    }
    if ('removed' in write) {
      return write.removed.map((id) => path.dirname(id));
    }
    return 'indexed' in write ? [write.indexed] : [];
  });
}

/**
 * Keeps the catalog true to the disk for what views show. Each folder is read once a session,
 * breadth first, and only what differs from the catalog is written, so reopening a library
 * the catalog holds is a walk of `readdir` and `stat` calls that writes almost nothing, while
 * its views already show it. The watcher keeps folders read this session current after that.
 */
export class Indexer {
  /** Folders read this session, which the watcher keeps current since. */
  private readonly current = new Set<string>();
  private readonly reading = new Map<string, Promise<FolderRead>>();
  /** Folders forgotten while a read of them was under way, which it then must not mark current. */
  private readonly stale = new Set<string>();
  private readonly reads = pLimit(READ_AHEAD);
  /**
   * The number of the last write of each folder's rows, which the window's reads of the folder
   * wait for, as the catalog's reader sees only what was written.
   */
  private readonly written = new Map<string, number>();

  constructor(private readonly sources: IndexerSources) {
    // A folder whose rows did not reach the catalog is read again when next asked for.
    sources.catalog.onWriteFailed((writes) => this.forget(foldersOf(writes)));
  }

  /** Reads the folders of `scope` the catalog may have wrong, until done or `signal` aborts. */
  index(scope: Scope, signal: AbortSignal): IndexRun {
    const first = Promise.withResolvers<null>();
    // Once the scope's own folder is read, with its rows in the catalog for the view to show.
    const firstRead = () => this.committed(scope.directoryId).then(() => first.resolve(null));
    const progress = { error: null as string | null, errors: [] as ReadError[], finished: false };
    const done = (async () => {
      try {
        await this.walk(scope, signal, (folder, read) => {
          progress.errors.push(...read.errors);
          if (folder === scope.directoryId) {
            progress.error = read.error;
            firstRead();
          }
        });
      } catch (error) {
        progress.error ??= errorMessage(error);
      } finally {
        progress.finished = true;
        firstRead();
      }
    })();
    return Object.assign(progress, { done, first: first.promise });
  }

  private async walk(
    scope: Scope,
    signal: AbortSignal,
    onRead: (folder: string, read: FolderRead) => void,
  ) {
    const { catalog } = this.sources;
    const folders = [scope.directoryId];
    // Folders the catalog knew are found again on disk, possibly not as they were; those found
    // in this walk were listed inside a folder already resolved.
    const known = new Set<string>(folders);
    if (scope.recursive) {
      const inside = await catalog.call('foldersInside', scope.directoryId);
      for (const id of inside.toSorted((left, right) => depthOf(left) - depthOf(right))) {
        folders.push(id);
        known.add(id);
      }
    }
    const listed = new Set(folders);
    // Folders start a few at a time, rather than all queued with `this.reads`, which limits reads
    // across walks: a library can hold a hundred thousand folders, which queued would take a
    // hundred megabytes, and a walk that stops must leave the rest unread.
    const active = new Set<Promise<void>>();
    let next = 0;
    while (next < folders.length || active.size > 0) {
      while (next < folders.length && active.size < READ_AHEAD && !signal.aborted) {
        const folder = folders[next] as string;
        next += 1;
        const task = this.folder(folder, known.has(folder))
          .then((read) => {
            onRead(folder, read);
            for (const subfolder of scope.recursive ? read.subfolders : []) {
              if (!listed.has(subfolder)) {
                listed.add(subfolder);
                folders.push(subfolder);
              }
            }
          })
          .finally(() => active.delete(task));
        active.add(task);
      }
      if (active.size === 0) {
        break;
      }
      await Promise.race(active);
    }
    signal.throwIfAborted();
  }

  /**
   * Reads `folderId` into the catalog unless it was read this session, settling once its rows
   * are there for the window to read. It was named by the window, so it is resolved on disk,
   * checking it is inside the library.
   */
  async list(folderId: string): Promise<FolderRead> {
    const read = await this.folder(folderId, true);
    await this.committed(folderId);
    return read;
  }

  /** Settles once the rows of `folderId` written so far are in the catalog. */
  private committed(folderId: string) {
    return this.sources.catalog.committed(this.written.get(folderId) ?? 0);
  }

  /** Hands the catalog a write of the rows of `folderId`. */
  private write(folderId: string, write: CatalogWrite) {
    this.written.set(folderId, this.sources.catalog.write(write));
  }

  /** Reads `folderId` unless it was read this session, sharing a read under way. */
  private folder(folderId: string, resolving: boolean): Promise<FolderRead> {
    if (this.current.has(folderId)) {
      // Its subfolders are in the catalog, which the walk read them from.
      return Promise.resolve({ error: null, errors: [], subfolders: [] });
    }
    let read = this.reading.get(folderId);
    if (!read) {
      read = this.reads(() => this.read(folderId, resolving))
        .catch((error: unknown): FolderRead => {
          const message = errorMessage(error);
          return {
            error: message,
            errors: [{ entryId: folderId, message, path: folderId }],
            subfolders: [],
          };
        })
        .finally(() => this.reading.delete(folderId));
      this.reading.set(folderId, read);
    }
    return read;
  }

  private async read(folderId: string, resolving: boolean): Promise<FolderRead> {
    const { catalog, resolve, root, signal } = this.sources;
    const errors: ReadError[] = [];
    const subfolders: string[] = [];
    const fail = (error: unknown): FolderRead => {
      const message = errorMessage(error);
      // IDs are paths relative to the root, so they say where a folder that fails is.
      errors.push({ entryId: folderId, message, path: folderId });
      return { error: message, errors, subfolders };
    };
    if (depthOf(folderId) > MAX_DEPTH) {
      return fail(new Error('Directory nesting exceeds the scan depth limit.'));
    }
    this.stale.delete(folderId);
    const known = new Map((await catalog.call('listing', folderId)).map((item) => [item.id, item]));
    let changed: PhotoEntry[] = [];
    try {
      for await (const item of readFolder(root, folderId, {
        resolve: resolving ? resolve : (id) => Promise.resolve(path.join(root, id)),
        signal,
      })) {
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
    if (!this.stale.has(folderId)) {
      if (known.size > 0) {
        this.write(folderId, { removed: [...known.keys()] });
      }
      this.write(folderId, { indexed: folderId });
      this.current.add(folderId);
    }
    return { error: null, errors, subfolders };
  }

  /** Folders to read again, as they changed; every folder if none are given. */
  forget(folderIds?: Iterable<string>): void {
    const ids = folderIds ? [...folderIds] : [...this.current, ...this.reading.keys()];
    for (const id of ids) {
      this.current.delete(id);
      if (this.reading.has(id)) {
        this.stale.add(id);
      }
    }
  }

  /** Forgets `folderId` and every folder inside it, which went with it. */
  forgetInside(folderId: string): void {
    const prefix = `${folderId}${path.sep}`;
    this.forget(
      [...this.current, ...this.reading.keys()].filter(
        (id) => id === folderId || id.startsWith(prefix),
      ),
    );
  }
}
