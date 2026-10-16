import { type DirectoryScan, openScan, type ScanState } from '#photos/data/directory-scan';
import { RequestQueue } from '#photos/data/request-queue';
import { ResourceCache } from '#photos/data/resource-cache';
import type {
  FolderSummary,
  PhotoEntry,
  PhotoFolder,
  PhotosAPI,
  ScanOptions,
  ThumbnailResult
} from '@app/shared';

export interface Cached<Value> {
  /** False for a value read before the last refresh, shown until the fresh one arrives. */
  fresh: boolean;
  value: Value;
}

function peek<Value>(
  cache: ResourceCache<Value>,
  stale: Map<string, Value>,
  key: string
): Cached<Value> | null {
  const settled = cache.peek(key);
  if (settled) {
    return { fresh: true, value: settled.value };
  }
  const previous = stale.get(key);
  return previous === undefined ? null : { fresh: false, value: previous };
}

/** Newest results win; repeated refreshes keep at most `limit` stale entries. */
function carryOver<Value>(stale: Map<string, Value>, fresh: Map<string, Value>, limit: number) {
  return new Map([...stale, ...fresh].slice(-limit));
}

/**
 * Session cache and IPC backpressure, independent of React and routing. Reads return
 * shared promises for `use()`; `peek*` returns settled values so cached views paint at once.
 */
export class PhotoLibrary {
  readonly id = crypto.randomUUID();
  /** Bumped by `refresh`; views holding derived data reload it without remounting. */
  generation = 0;
  private gallery: DirectoryScan | null = null;
  private version = 0;
  private readonly listeners = new Set<() => void>();
  private readonly interest = new Map<string, number>();
  private readonly directories = new ResourceCache<ScanState>(new RequestQueue(2), 64, () =>
    this.changed()
  );
  private readonly summaries = new ResourceCache<FolderSummary | null>(new RequestQueue(4), 256);
  private readonly thumbnails = new ResourceCache<ThumbnailResult>(new RequestQueue(4), 512);
  private readonly originals = new ResourceCache<string | null>(new RequestQueue(4), 256);
  // After a refresh the previous results keep rendering until fresh ones replace them.
  private staleDirectories = new Map<string, ScanState>();
  private staleSummaries = new Map<string, FolderSummary | null>();
  private staleThumbnails = new Map<string, ThumbnailResult>();
  private readonly folders = new Map<string, PhotoEntry>();

  constructor(
    readonly root: PhotoFolder,
    readonly api: PhotosAPI
  ) {}

  /** `useSyncExternalStore` source for directory reads. */
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getVersion = () => this.version;

  private changed() {
    this.version += 1;
    for (const listener of this.listeners) {
      listener();
    }
  }

  /**
   * Marks an entry as on screen. Queued thumbnail and cover work for entries that scrolled
   * away waits until they are read again, so the visible ones are not stuck behind it.
   */
  want(entryId: string) {
    this.interest.set(entryId, (this.interest.get(entryId) ?? 0) + 1);
    return () => {
      const count = (this.interest.get(entryId) ?? 1) - 1;
      if (count === 0) {
        this.interest.delete(entryId);
      } else {
        this.interest.set(entryId, count);
      }
    };
  }

  /**
   * Loads and decodes the thumbnails a view opens with, so it can paint them on its first
   * frame. An aborted navigation stops holding them as wanted.
   */
  async preload(entries: PhotoEntry[], signal: AbortSignal) {
    const releases = entries.map((entry) => this.want(entry.id));
    const release = () => {
      for (const done of releases.splice(0)) {
        done();
      }
    };
    signal.addEventListener('abort', release, { once: true });
    await Promise.allSettled(
      entries.map(async (entry) => {
        let result: ThumbnailResult | null = null;
        if (entry.kind === 'image') {
          result = await this.thumbnail(entry.id);
        } else {
          const cover = (await this.summary(entry.id))?.cover;
          result = cover ? await this.thumbnail(cover.id, entry.id) : null;
        }
        if (result?.status === 'ready') {
          const image = new Image();
          image.src = result.url;
          await image.decode();
        }
      })
    );
    release();
  }

  private wanted(entryId: string) {
    return () => this.interest.has(entryId);
  }

  private rememberFolders(entries: PhotoEntry[]) {
    for (const entry of entries) {
      if (entry.kind === 'directory') {
        this.folders.set(entry.id, entry);
      }
    }
  }

  /** Opens the view's scan and reads its first page; later pages stream into the scan. */
  async openGallery(options: ScanOptions, signal: AbortSignal) {
    this.gallery?.close();
    const scan = await openScan(this.api, options, signal);
    this.gallery = scan;
    this.rememberFolders((await scan.next(signal)).entries);
    scan.subscribe(() => this.rememberFolders(scan.getSnapshot().entries));
    scan.stream();
    return scan;
  }

  /** A folder's complete, shallow listing. */
  directory(directoryId: string) {
    return this.directories.read(directoryId, async () => {
      try {
        const scan = await openScan(this.api, { directoryId }, new AbortController().signal);
        const always = new AbortController().signal;
        let state = await scan.next(always);
        while (state.loading) {
          state = await scan.next(always);
        }
        this.rememberFolders(state.entries);
        return state;
      } catch (error) {
        return { entries: [], error: String(error), errors: [], loading: false };
      }
    });
  }

  peekDirectory(directoryId: string) {
    return peek(this.directories, this.staleDirectories, directoryId);
  }

  trail(id: string) {
    const trail: PhotoFolder[] = [];
    let current = id;
    while (current !== this.root.id) {
      const folder = this.folders.get(current);
      if (!folder || trail.length > 128) {
        return null;
      }
      trail.unshift(folder);
      current = folder.parentId;
    }
    return [this.root, ...trail];
  }

  /** Folder covers and whether a folder has subfolders; `null` if it could not be read. */
  summary(directoryId: string) {
    return this.summaries.read(
      directoryId,
      () => this.api.inspectFolder(directoryId).catch(() => null),
      this.wanted(directoryId)
    );
  }

  peekSummary(directoryId: string) {
    return peek(this.summaries, this.staleSummaries, directoryId);
  }

  /** `owner` is the on-screen entry the thumbnail is for, such as the folder it covers. */
  thumbnail(entryId: string, owner = entryId) {
    return this.thumbnails.read(
      entryId,
      () =>
        this.api
          .requestThumbnail({ entryId, preset: 'grid', requestId: crypto.randomUUID() })
          .catch((error: unknown): ThumbnailResult => ({
            message: String(error),
            status: 'failed'
          })),
      this.wanted(owner)
    );
  }

  peekThumbnail(entryId: string) {
    return peek(this.thumbnails, this.staleThumbnails, entryId);
  }

  /** Original URLs are stable for a session; `null` if the photo is unavailable. */
  original(entryId: string) {
    return this.originals.read(entryId, () => this.api.getOriginalURL(entryId).catch(() => null));
  }

  peekOriginal(entryId: string) {
    const settled = this.originals.peek(entryId);
    return settled && { fresh: true, value: settled.value };
  }

  refresh() {
    this.dispose();
    this.generation += 1;
    this.originals.clear();
    const directories = this.directories.clear();
    this.staleDirectories = carryOver(this.staleDirectories, directories, 64);
    this.staleSummaries = carryOver(this.staleSummaries, this.summaries.clear(), 256);
    this.staleThumbnails = carryOver(this.staleThumbnails, this.thumbnails.clear(), 512);
    // Expanded folders keep their old children on screen while they are read again.
    for (const directoryId of directories.keys()) {
      this.directory(directoryId).catch(() => null);
    }
  }

  dispose() {
    this.gallery?.close();
  }
}
