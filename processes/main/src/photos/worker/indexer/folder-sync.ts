import { isNotFoundOrNotAFolder } from '#photos/worker/disk/fs-errors';
import { readFolder } from '#photos/worker/disk/read-folder';
import type { Share } from '#photos/worker/disk/share/share';
import { ShareOfflineError } from '#photos/worker/disk/share/share-offline-error';
import type { FolderSession } from '#photos/worker/indexer/folder-session';
import { depthOf } from '#photos/worker/indexer/folder-walk';
import type { FolderRead } from '#photos/worker/indexer/index-run';
import {
  type EntriesRead,
  writeChangedEntries,
} from '#photos/worker/indexer/write-changed-entries';
import type { Catalog, CatalogWrite, FolderStamp, KnownItem } from '@prism/catalog';
import { errorMessage, Listeners, type ReadError } from '@prism/shared';
import path from 'node:path';

// Only a folder linked inside itself goes this deep; symbolic links are skipped already.
const MAX_DEPTH = 1024;
const TOO_DEEP = 'Directory nesting exceeds the scan depth limit.';

export interface FolderSyncSources {
  /** The canonical path of the folder opened. */
  root: string;
  catalog: Catalog;
  /** Finds an entry on disk, checking it is inside `root`. */
  resolve: (entryId: string) => Promise<string>;
  /** Stops every read, as the folder closes. */
  signal: AbortSignal;
  /**
   * Whether the library's folder can be reached. A read checks it before it removes anything or
   * records a failure as the folder's own, so nothing is lost from a folder whose volume went
   * offline.
   */
  share: Share;
  /** The time now, which the catalog notes each folder was read at; tests set it. */
  now: () => number;
}

/** The folder a read is of, and when it began. */
interface ReadStart {
  folderId: string;
  /** When the read began, which the catalog notes as the folder's read time. */
  readMs: number;
}

/** What the catalog had of a folder before a read of it. */
interface CatalogBefore {
  /** The folder's entries, by ID. The read takes out each one it lists. */
  known: Map<string, KnownItem>;
  /** The IDs of its subfolders. */
  subfolders: Set<string>;
  /** Whether the catalog had read the folder to the end before. */
  isIndexed: boolean;
}

/**
 * Reads one folder at a time from the disk into the catalog, for the `Indexer`. It also keeps
 * track of each folder's last write, which the window's reads wait for, and reports folders
 * whose listing a read changed.
 */
export class FolderSync {
  readonly #relistedListeners = new Listeners<string>();
  /**
   * The number of the last write of each folder's rows. The window's reads of a folder wait for
   * it, because the catalog's reader only sees what has been written.
   */
  readonly #lastWriteOf = new Map<string, number>();

  constructor(
    private readonly sources: FolderSyncSources,
    /** Which folders this session read, is reading, or failed to; the `Indexer`'s. */
    private readonly session: FolderSession,
  ) {}

  /** Calls `listener` with each folder whose listing a read changed; see `Indexer.onRelisted`. */
  onRelisted(listener: (folderId: string) => void): () => void {
    return this.#relistedListeners.add(listener);
  }

  /** Settles once the rows of `folderId` written so far are in the catalog. */
  waitForWrites(folderId: string): Promise<void> {
    return this.sources.catalog.committed(this.#lastWriteOf.get(folderId) ?? 0);
  }

  /**
   * Reads `folderId` from the disk and writes what differs to the catalog. `resolving` finds the
   * folder on disk with its links resolved, for a folder that may have changed.
   */
  async readFromDisk(folderId: string, resolving: boolean): Promise<FolderRead> {
    // Noted before reading, so anything that changes after this moment is left to the next read.
    const start = { folderId, readMs: this.sources.now() };
    if (depthOf(folderId) > MAX_DEPTH) {
      return this.#recordFailure(start, { errors: [], subfolders: [] }, new Error(TOO_DEEP));
    }
    this.session.stale.delete(folderId);
    const before = await this.#catalogBefore(folderId);
    const read = await this.#readEntries(folderId, resolving, before.known);
    switch (read.outcome.kind) {
      case 'failed': {
        return this.#handleFailure(start, read, read.outcome.error);
      }
      default: {
        return this.#finishRead(start, before, { ...read, stamp: read.outcome.stamp });
      }
    }
  }

  /** What the catalog has of `folderId` now, before the read. */
  async #catalogBefore(folderId: string): Promise<CatalogBefore> {
    const { catalog } = this.sources;
    const [listing, isIndexed] = await Promise.all([
      catalog.call('knownItemsIn', folderId),
      catalog.call('isIndexed', folderId),
    ]);
    const known = new Map(listing.map((item) => [item.id, item]));
    const subfolders = new Set(
      [...known.values()].filter((item) => item.kind === 'directory').map((item) => item.id),
    );
    return { isIndexed, known, subfolders };
  }

  /** Reads the entries of `folderId` from the disk, writing the ones that differ from `known`. */
  #readEntries(folderId: string, resolving: boolean, known: Map<string, KnownItem>) {
    const { resolve, root, signal } = this.sources;
    const items = readFolder(root, folderId, {
      resolve: resolving ? resolve : (id) => Promise.resolve(path.join(root, id)),
      signal,
    });
    return writeChangedEntries(items, known, (listed) =>
      this.#write(folderId, { entries: listed, kind: 'list' }),
    );
  }

  /**
   * Handles a read that failed partway. Nothing at the folder, or a folder that does not answer,
   * may only mean the volume went away. Then the folder stays as the catalog has it, and the
   * scheduler has the read wait until the volume is back. Any other failure is the folder's own.
   */
  async #handleFailure(start: ReadStart, found: EntriesRead, error: unknown): Promise<FolderRead> {
    this.sources.signal.throwIfAborted();
    if (await this.sources.share.failedOffline(error)) {
      throw new ShareOfflineError();
    }
    return this.#recordFailure(start, found, error);
  }

  /**
   * Records that the read failed with `error`, and returns the failed read with what it `found`
   * before failing.
   */
  #recordFailure(
    { folderId, readMs }: ReadStart,
    found: { errors: ReadError[]; subfolders: string[] },
    error: unknown,
  ): FolderRead {
    const message = errorMessage(error);
    // IDs are paths relative to the root, so they say where a folder that fails is.
    const errors = [...found.errors, { entryId: folderId, message, path: folderId }];
    const read = {
      error: message,
      errors,
      missing: isNotFoundOrNotAFolder(error),
      subfolders: found.subfolders,
    };
    // Reported when it starts failing, or fails differently, so the window lists it again.
    if (this.session.failed.get(folderId)?.error !== message) {
      this.#reportRelisted(folderId);
    }
    this.session.failed.set(folderId, read);
    this.#write(folderId, { folderId, kind: 'stamp', readMs, stamp: null });
    return read;
  }

  /**
   * Finishes a read that got to the end. Unless the folder changed during the read, what the
   * catalog has that the read did not list is removed, and the folder is marked as read with its
   * stamp. The window is told if the folder's subfolders changed.
   */
  async #finishRead(
    start: ReadStart,
    before: CatalogBefore,
    {
      errors,
      subfolders,
      stamp,
    }: { errors: ReadError[]; subfolders: string[]; stamp: FolderStamp | null },
  ): Promise<FolderRead> {
    const { folderId } = start;
    // If the folder changed again while we read it, this read is incomplete, so the next read
    // finishes the job.
    const complete = !this.session.stale.has(folderId);
    // A listing with less than the catalog has may come from a volume that went away during the
    // read, or from the empty folder an unmounted volume leaves behind.
    if (complete && before.known.size > 0 && !(await this.sources.share.isVolumeThere())) {
      throw new ShareOfflineError();
    }
    if (complete) {
      this.#markRead(start, before.known, stamp);
    }
    const wasFailed = this.session.failed.delete(folderId);
    // The subfolders differ from the ones the catalog had: there is one it did not have, or,
    // once the read is complete, there are fewer.
    const relisted =
      subfolders.some((id) => !before.subfolders.has(id)) ||
      (complete && subfolders.length !== before.subfolders.size);
    if (relisted || wasFailed || (complete && !before.isIndexed)) {
      this.#reportRelisted(folderId);
    }
    return { error: null, errors, missing: false, subfolders };
  }

  /**
   * Writes a complete read: removes what the catalog has that the read did not list
   * (`unlisted`), and marks the folder as read to the end, with its stamp.
   */
  #markRead(
    { folderId, readMs }: ReadStart,
    unlisted: Map<string, KnownItem>,
    stamp: FolderStamp | null,
  ) {
    if (unlisted.size > 0) {
      this.#write(folderId, { ids: [...unlisted.keys()], kind: 'remove' });
    }
    this.#write(folderId, { folderId, kind: 'markIndexed' });
    this.#write(folderId, { folderId, kind: 'stamp', readMs, stamp });
    this.session.current.add(folderId);
  }

  /** Hands the catalog a write of the rows of `folderId`. */
  #write(folderId: string, write: CatalogWrite) {
    this.#lastWriteOf.set(folderId, this.sources.catalog.write(write));
  }

  /**
   * Reports `folderId` to the listeners once its rows are committed, because the window then
   * reads its listing and subfolders again from the catalog's reader.
   */
  #reportRelisted(folderId: string) {
    this.waitForWrites(folderId).then(() => {
      this.#relistedListeners.tell(folderId);
    });
  }
}
