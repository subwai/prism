import type { Catalog } from '#photos/catalog/client';
import type { Scope } from '#photos/catalog/data/scope';
import type { CatalogWrite } from '#photos/catalog/writes';
import { errorMessage } from '#photos/errors';
import { readFolder } from '#photos/read-folder';
import type { PhotoEntry, ReadError } from '@prism/shared';
import path from 'node:path';
import pLimit from 'p-limit';

// Folders read at once, across every view. A network share answers many at once about as fast
// as one, while a local disk gains little past a few.
const READ_AHEAD = 16,
  // Only a folder linked inside itself goes this deep; symbolic links are skipped already.
  MAX_DEPTH = 1024,
  // Entries a read hands the catalog at a time, so a large folder shows as it is read.
  WRITE_CHUNK = 256;

/** A view's read of the folders it shows, as it goes. */
export interface IndexRun {
  /** Settles once the scope's own folder has been read, or could not be. */
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

/** Whether a listing of an entry says something other than what the catalog knows of it. */
function differs(
  known: { kind: PhotoEntry['kind']; size: number | null; modifiedMs: number | null } | undefined,
  entry: PhotoEntry,
) {
  return (
    known?.kind !== entry.kind ||
    known.size !== (entry.metadata?.size ?? null) ||
    known.modifiedMs !== (entry.metadata?.modifiedMs ?? null)
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
export interface Indexer {
  /** Reads the folders of `scope` the catalog may have wrong, until done or `signal` aborts. */
  index: (scope: Scope, signal: AbortSignal) => IndexRun;
  /**
   * Reads `folderId` into the catalog unless it was read this session. It was named by the
   * window, so it is resolved on disk, checking it is inside the library.
   */
  list: (folderId: string) => Promise<FolderRead>;
  /** Folders to read again, as they changed; every folder if none are given. */
  forget: (folderIds?: Iterable<string>) => void;
  /** Forgets `folderId` and every folder inside it, which went with it. */
  forgetInside: (folderId: string) => void;
}

export function createIndexer(sources: IndexerSources): Indexer {
  const { catalog, resolve, root, signal } = sources;
  /** Folders read this session, which the watcher keeps current since. */
  const current = new Set<string>();
  const reading = new Map<string, Promise<FolderRead>>();
  /** Folders forgotten while a read of them was under way, which it then must not mark current. */
  const stale = new Set<string>();
  const reads = pLimit(READ_AHEAD);

  function forget(folderIds?: Iterable<string>) {
    const ids = folderIds ? [...folderIds] : [...current, ...reading.keys()];
    for (const id of ids) {
      current.delete(id);
      if (reading.has(id)) {
        stale.add(id);
      }
    }
  }

  // A folder whose rows did not reach the catalog is read again when next asked for.
  catalog.onWriteFailed((writes) => forget(foldersOf(writes)));

  async function read(folderId: string, resolving: boolean): Promise<FolderRead> {
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
    stale.delete(folderId);
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
            catalog.write({ listed: changed });
            changed = [];
          }
        }
        known.delete(entry.id);
      }
    } catch (error) {
      signal.throwIfAborted();
      if (changed.length > 0) {
        catalog.write({ listed: changed });
      }
      return fail(error);
    }
    if (changed.length > 0) {
      catalog.write({ listed: changed });
    }
    // A read that saw the folder before it changed again leaves it to the next one.
    if (!stale.has(folderId)) {
      if (known.size > 0) {
        catalog.write({ removed: [...known.keys()] });
      }
      catalog.write({ indexed: folderId });
      current.add(folderId);
    }
    return { error: null, errors, subfolders };
  }

  /** Reads `folderId` unless it was read this session, sharing a read under way. */
  function folder(folderId: string, resolving: boolean): Promise<FolderRead> {
    if (current.has(folderId)) {
      // Its subfolders are in the catalog, which the walk read them from.
      return Promise.resolve({ error: null, errors: [], subfolders: [] });
    }
    let pending = reading.get(folderId);
    if (!pending) {
      pending = reads(() => read(folderId, resolving))
        .catch((error: unknown): FolderRead => {
          const message = errorMessage(error);
          return {
            error: message,
            errors: [{ entryId: folderId, message, path: folderId }],
            subfolders: [],
          };
        })
        .finally(() => reading.delete(folderId));
      reading.set(folderId, pending);
    }
    return pending;
  }

  async function walk(
    scope: Scope,
    walkSignal: AbortSignal,
    onRead: (folder: string, read: FolderRead) => void,
  ) {
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
    const active = new Set<Promise<void>>();
    let next = 0;
    while (next < folders.length || active.size > 0) {
      while (next < folders.length && active.size < READ_AHEAD && !walkSignal.aborted) {
        const id = folders[next] as string;
        next += 1;
        const task = folder(id, known.has(id))
          .then((result) => {
            onRead(id, result);
            for (const subfolder of scope.recursive ? result.subfolders : []) {
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
    walkSignal.throwIfAborted();
  }

  return {
    forget,
    forgetInside(folderId) {
      const prefix = `${folderId}${path.sep}`;
      forget(
        [...current, ...reading.keys()].filter((id) => id === folderId || id.startsWith(prefix)),
      );
    },
    index(scope, walkSignal) {
      const first = Promise.withResolvers<null>();
      const progress = { error: null as string | null, errors: [] as ReadError[], finished: false };
      const done = (async () => {
        try {
          await walk(scope, walkSignal, (id, result) => {
            progress.errors.push(...result.errors);
            if (id === scope.directoryId) {
              progress.error = result.error;
              first.resolve(null);
            }
          });
        } catch (error) {
          progress.error ??= errorMessage(error);
        } finally {
          progress.finished = true;
          first.resolve(null);
        }
      })();
      return Object.assign(progress, { done, first: first.promise });
    },
    list: (folderId) => folder(folderId, true),
  };
}
