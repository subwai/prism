import { isMissing } from '#photos/worker/fs-errors';
import { FolderSession } from '#photos/worker/indexer/folder-session';
import { isUnchanged, wasReadSince } from '#photos/worker/indexer/folder-stamps';
import { depthOf, walkFolders } from '#photos/worker/indexer/folder-walk';
import type { FolderRead, IndexOptions, IndexRun } from '#photos/worker/indexer/index-run';
import { readFolder } from '#photos/worker/indexer/read-folder';
import { trackWalks } from '#photos/worker/indexer/walks';
import {
  foldersWrittenBy,
  writeChangedEntries,
} from '#photos/worker/indexer/write-changed-entries';
import type { CurrentPriority, Scheduler } from '#photos/worker/scheduler/scheduler';
import type { Share } from '#photos/worker/share/share';
import { ShareOfflineError } from '#photos/worker/share/share-offline-error';
import type { Catalog, CatalogWrite, FolderStamp, Scope } from '@prism/catalog';
import { errorMessage, Listeners, type ReadError } from '@prism/shared';
import path from 'node:path';

// Only a folder linked inside itself goes this deep; symbolic links are skipped already.
const MAX_DEPTH = 1024;

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
  /**
   * Whether the library's folder can be reached. A read checks it before it removes anything or
   * records a failure as the folder's own, so nothing is lost from a folder whose volume went
   * offline.
   */
  share: Share;
  /** The time now, which the catalog notes each folder was read at; tests set it. */
  now: () => number;
}

/**
 * Keeps the catalog true to the disk.
 * - Each folder is read once a session, breadth first. Reads run in the background, apart from
 *   the folder a view opens on and the folders on screen.
 * - Only what differs from the catalog is written. Reopening a library the catalog already holds
 *   is then a walk of `readdir` and `stat` calls that writes almost nothing, while its views
 *   already show it.
 * - After that, the watcher keeps the folders read this session up to date.
 */
export class Indexer {
  /** Which folders this session read, is reading, or failed to. */
  private readonly session = new FolderSession();
  private readonly relistedListeners = new Listeners<string>();
  /** How far each walk under way has got, which the status bar shows. */
  readonly walks = trackWalks();
  /**
   * The number of the last write of each folder's rows. The window's reads of a folder wait for
   * it, because the catalog's reader only sees what has been written.
   */
  private readonly lastWriteOf = new Map<string, number>();

  constructor(private readonly sources: IndexerSources) {
    // A folder whose rows did not reach the catalog is read again when next asked for.
    sources.catalog.onWriteFailed((writes) => this.forget(foldersWrittenBy(writes)));
  }

  /**
   * Calls `listener` with each folder whose listing a read changed for the window, once the
   * change is written to the catalog: the read found other subfolders, read the folder to the end
   * for the first time, or failed.
   */
  onRelisted(listener: (folderId: string) => void): () => void {
    return this.relistedListeners.add(listener);
  }

  /** Reads the folders of `scope` the catalog may have wrong, until done or `signal` aborts. */
  index(scope: Scope, signal: AbortSignal, options: IndexOptions = {}): IndexRun {
    const progress = { error: null as string | null, errors: [] as ReadError[], finished: false };
    const walk = this.walks.start(options.fullRead ?? false);
    const done = (async () => {
      try {
        await this.walk(scope, signal, options, walk.progress, (folder, read) => {
          progress.errors.push(...read.errors);
          if (folder === scope.directoryId) {
            progress.error = read.error;
          }
        });
      } catch (error) {
        progress.error ??= errorMessage(error);
      } finally {
        progress.finished = true;
        walk.end();
      }
    })();
    return Object.assign(progress, { done, walk: walk.walk });
  }

  private async walk(
    scope: Scope,
    signal: AbortSignal,
    { fullRead = false, readSince }: IndexOptions,
    onProgress: (looked: number, found: number) => void,
    onRead: (folder: string, read: FolderRead) => void,
  ) {
    const { catalog } = this.sources;
    const knownFolders = scope.recursive
      ? await catalog.call('foldersInside', scope.directoryId)
      : [];
    await walkFolders({
      knownFolders,
      onProgress,
      onRead,
      read: async (folder, found, priority) =>
        this.session.current.has(folder) ||
        (readSince !== undefined && (await wasReadSince(catalog, folder, readSince))) ||
        (!fullRead && found === 'known' && (await isUnchanged(this.sources, folder, priority)))
          ? this.readThisSession(folder)
          : this.scheduleRead(folder, found !== 'listed', priority),
      scope,
      signal,
    });
  }

  /**
   * The read of `folderId` that this session made before the walk got to it. Its subfolders come
   * from the catalog, because the walk may have started before that read wrote them, as on an
   * empty catalog.
   */
  private async readThisSession(folderId: string): Promise<FolderRead> {
    await this.waitForWrites(folderId);
    const subfolders = await this.sources.catalog.call('subfolderIds', [folderId]);
    return { error: null, errors: [], missing: false, subfolders };
  }

  /**
   * Reads `folderId` into the catalog at `priority`, unless it was read this session, and
   * settles once its rows are there for the window to read. The window named the folder, so it
   * is resolved on disk, which checks that it is inside the library.
   */
  async readIntoCatalog(folderId: string, priority: CurrentPriority): Promise<FolderRead> {
    const read = await this.scheduleRead(folderId, true, priority);
    await this.waitForWrites(folderId);
    return read;
  }

  /** The failed read of `folderId`, if its last read this session failed. */
  failedRead(folderId: string): FolderRead | undefined {
    return this.session.failed.get(folderId);
  }

  /** Settles once the rows of `folderId` written so far are in the catalog. */
  private waitForWrites(folderId: string) {
    return this.sources.catalog.committed(this.lastWriteOf.get(folderId) ?? 0);
  }

  /** Hands the catalog a write of the rows of `folderId`. */
  private write(folderId: string, write: CatalogWrite) {
    this.lastWriteOf.set(folderId, this.sources.catalog.write(write));
  }

  /**
   * Reads `folderId` in the scheduler unless it was read this session. A read of it that is
   * waiting or under way is shared, because the scheduler joins jobs with the same key. The
   * shared read then runs at the highest priority of those who asked.
   */
  private scheduleRead(
    folderId: string,
    resolving: boolean,
    priority: CurrentPriority,
  ): Promise<FolderRead> {
    if (this.session.current.has(folderId)) {
      // Its subfolders are already in the catalog, and the window reads them from there.
      return Promise.resolve({ error: null, errors: [], missing: false, subfolders: [] });
    }
    return this.sources.scheduler
      .run('folder', `read ${folderId}`, priority, async () => {
        this.session.reading.add(folderId);
        try {
          return await this.readFromDisk(folderId, resolving);
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

  private async readFromDisk(folderId: string, resolving: boolean): Promise<FolderRead> {
    const { catalog, now, resolve, root, share, signal } = this.sources;
    // Noted before reading, so anything that changes after this moment is left to the next read.
    const readMs = now();
    const errors: ReadError[] = [];
    const subfolders: string[] = [];
    const fail = (error: unknown): FolderRead => {
      const message = errorMessage(error);
      // IDs are paths relative to the root, so they say where a folder that fails is.
      errors.push({ entryId: folderId, message, path: folderId });
      const read = { error: message, errors, missing: isMissing(error), subfolders };
      // Reported when it starts failing, or fails differently, so the window lists it again.
      if (this.session.failed.get(folderId)?.error !== message) {
        this.reportRelisted(folderId);
      }
      this.session.failed.set(folderId, read);
      this.write(folderId, { folderId, kind: 'stamp', readMs, stamp: null });
      return read;
    };
    if (depthOf(folderId) > MAX_DEPTH) {
      return fail(new Error('Directory nesting exceeds the scan depth limit.'));
    }
    this.session.stale.delete(folderId);
    const [listing, indexed] = await Promise.all([
      catalog.call('knownItemsIn', folderId),
      catalog.call('isIndexed', folderId),
    ]);
    const known = new Map(listing.map((item) => [item.id, item]));
    const before = new Set(
      [...known.values()].filter((item) => item.kind === 'directory').map((item) => item.id),
    );
    let stamp: FolderStamp | null;
    try {
      const items = readFolder(root, folderId, {
        resolve: resolving ? resolve : (id) => Promise.resolve(path.join(root, id)),
        signal,
      });
      stamp = await writeChangedEntries(items, known, { errors, subfolders }, (listed) =>
        this.write(folderId, { entries: listed, kind: 'list' }),
      );
    } catch (error) {
      signal.throwIfAborted();
      // Nothing at the folder, or a folder that does not answer, may only mean the volume went
      // away. Then the folder stays as the catalog has it, and the scheduler has the read wait
      // until the volume is back.
      if (await share.failedOffline(error)) {
        throw new ShareOfflineError();
      }
      return fail(error);
    }
    // If the folder changed again while we read it, this read is incomplete, so the next read
    // finishes the job.
    const complete = !this.session.stale.has(folderId);
    // A listing with less than the catalog has may come from a volume that went away during the
    // read, or from the empty folder an unmounted volume leaves behind.
    if (complete && known.size > 0 && !(await share.isVolumeThere())) {
      throw new ShareOfflineError();
    }
    if (complete) {
      if (known.size > 0) {
        this.write(folderId, { ids: [...known.keys()], kind: 'remove' });
      }
      this.write(folderId, { folderId, kind: 'markIndexed' });
      this.write(folderId, { folderId, kind: 'stamp', readMs, stamp });
      this.session.current.add(folderId);
    }
    const wasFailed = this.session.failed.delete(folderId);
    // The subfolders differ from the ones the catalog had (`before`): there is one it did not
    // have, or, once the read is complete, there are fewer.
    const relisted =
      subfolders.some((id) => !before.has(id)) || (complete && subfolders.length !== before.size);
    if (relisted || wasFailed || (complete && !indexed)) {
      this.reportRelisted(folderId);
    }
    return { error: null, errors, missing: false, subfolders };
  }

  /**
   * Reports `folderId` to the listeners once its rows are committed, because the window then
   * reads its listing and subfolders again from the catalog's reader.
   */
  private reportRelisted(folderId: string) {
    this.waitForWrites(folderId).then(() => {
      this.relistedListeners.tell(folderId);
    });
  }

  /** Marks folders to be read again because they changed; every folder if none are given. */
  forget(folderIds?: Iterable<string>): void {
    this.session.forget(folderIds);
  }

  /** Forgets `folderId` and every folder inside it, which went away with it. */
  forgetInside(folderId: string): void {
    this.session.forgetInside(folderId);
  }

  /** Notes that the app moved `from` to `to` with its rows; see `FolderSession.moved`. */
  moved(from: string, to: string): void {
    this.session.moved(from, to);
  }
}
