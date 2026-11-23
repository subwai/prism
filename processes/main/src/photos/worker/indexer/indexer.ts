import { FolderSession } from '#photos/worker/indexer/folder-session';
import { FolderSync, type FolderSyncSources } from '#photos/worker/indexer/folder-sync';
import { isUnchanged, wasReadSince } from '#photos/worker/indexer/folder-times';
import { walkFolders } from '#photos/worker/indexer/folder-walk';
import type { FolderRead, IndexOptions, IndexRun } from '#photos/worker/indexer/index-run';
import { trackWalks } from '#photos/worker/indexer/walks';
import { foldersWrittenBy } from '#photos/worker/indexer/write-changed-entries';
import type { CurrentPriority, Scheduler } from '#photos/worker/scheduler/scheduler';
import type { Scope } from '@prism/catalog';
import { errorMessage, type ReadError } from '@prism/shared';

export interface IndexerSources extends FolderSyncSources {
  /** Orders every read of the disk. */
  scheduler: Scheduler;
}

/** What `Indexer.walk` walks, and whom it tells as it goes. */
interface WalkRequest {
  scope: Scope;
  /** Stops the walk. */
  signal: AbortSignal;
  options: IndexOptions;
  /** Called with how many folders the walk has looked at, of how many it has found so far. */
  onProgress: (looked: number, found: number) => void;
  /** Called with each folder's read as it ends. */
  onRead: (folder: string, read: FolderRead) => void;
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
  /** Reads one folder at a time from the disk into the catalog. */
  private readonly folderSync: FolderSync;
  /** How far each walk under way has got, which the status bar shows. */
  readonly walks = trackWalks();

  constructor(private readonly sources: IndexerSources) {
    this.folderSync = new FolderSync(sources, this.session);
    // A folder whose rows did not reach the catalog is read again when next asked for.
    sources.catalog.onWriteFailed((writes) => this.forget(foldersWrittenBy(writes)));
  }

  /**
   * Calls `listener` with each folder whose contents a read changed for the window, once the
   * change is written to the catalog: the read found other subfolders, read the folder to the end
   * for the first time, or failed.
   */
  onContentsChanged(listener: (folderId: string) => void): () => void {
    return this.folderSync.onContentsChanged(listener);
  }

  /** Reads the folders of `scope` the catalog may have wrong, until done or `signal` aborts. */
  index(scope: Scope, signal: AbortSignal, options: IndexOptions = {}): IndexRun {
    const progress = { error: null as string | null, errors: [] as ReadError[], finished: false };
    const walk = this.walks.start(options.fullRead ?? false);
    const done = (async () => {
      try {
        await this.walk({
          onProgress: walk.progress,
          onRead: (folder, read) => {
            progress.errors.push(...read.errors);
            if (folder === scope.directoryId) {
              progress.error = read.error;
            }
          },
          options,
          scope,
          signal,
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

  /** Walks the folders of `scope`, reading the ones the catalog may have wrong. */
  private async walk({ scope, signal, options, onProgress, onRead }: WalkRequest) {
    const { fullRead = false, readSince } = options;
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
    return this.folderSync.waitForWrites(folderId);
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
          return await this.folderSync.readFromDisk(folderId, resolving);
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
