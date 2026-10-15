import { type DirectoryScan, openScan, type ScanState } from '#photos/data/directory-scan';
import { RequestQueue } from '#photos/data/request-queue';
import type {
  FolderSummary,
  PhotoEntry,
  PhotoFolder,
  PhotosAPI,
  ScanOptions,
  ThumbnailResult
} from '@app/shared';

function remember<Key, Value>(cache: Map<Key, Value>, key: Key, value: Value, limit: number) {
  cache.delete(key);
  cache.set(key, value);
  if (cache.size > limit) {
    const oldest = cache.keys().next();
    if (!oldest.done) {
      cache.delete(oldest.value);
    }
  }
}

/** Session cache and IPC backpressure, independent of React and routing. */
export class PhotoLibrary {
  id = crypto.randomUUID();
  private gallery: DirectoryScan | null = null;
  private readonly directoryQueue = new RequestQueue(2);
  private readonly directories = new Map<string, ScanState>();
  private readonly inspectionQueue = new RequestQueue(4);
  private readonly thumbnailQueue = new RequestQueue(4);
  private readonly summaries = new Map<string, FolderSummary>();
  private readonly thumbnails = new Map<string, ThumbnailResult>();
  private readonly folders = new Map<string, PhotoEntry>();

  constructor(
    readonly root: PhotoFolder,
    readonly api: PhotosAPI
  ) {}

  private rememberFolders(entries: PhotoEntry[]) {
    for (const entry of entries) {
      if (entry.kind === 'directory') {
        this.folders.set(entry.id, entry);
      }
    }
  }

  async openGallery(options: ScanOptions, signal: AbortSignal) {
    this.gallery?.close();
    const scan = await openScan(this.api, options, signal);
    this.gallery = scan;
    return { page: await this.next(scan.key, signal), scan };
  }

  async next(key: string, signal: AbortSignal) {
    if (this.gallery?.key !== key) {
      return { key, state: { entries: [], error: null, errors: [], loading: false } };
    }
    const state = await this.gallery.next(signal);
    this.rememberFolders(state.entries);
    return { key, state };
  }

  async readDirectory(directoryId: string, signal: AbortSignal) {
    const cached = this.directories.get(directoryId);
    if (cached) {
      return cached;
    }
    return await this.directoryQueue.run(async () => {
      const scan = await openScan(this.api, { directoryId }, signal);
      try {
        let state = await scan.next(signal);
        while (state.loading) {
          state = await scan.next(signal);
        }
        this.rememberFolders(state.entries);
        if (!state.error) {
          remember(this.directories, directoryId, state, 24);
        }
        return state;
      } finally {
        scan.close();
      }
    }, signal);
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

  async inspect(directoryId: string, signal: AbortSignal) {
    const cached = this.summaries.get(directoryId);
    if (cached) {
      return cached;
    }
    const summary = await this.inspectionQueue.run(
      () => this.api.inspectFolder(directoryId),
      signal
    );
    remember(this.summaries, directoryId, summary, 256);
    return summary;
  }

  async thumbnail(entryId: string, signal: AbortSignal) {
    const cached = this.thumbnails.get(entryId);
    if (cached) {
      return cached;
    }
    return await this.thumbnailQueue.run(async () => {
      const requestId = crypto.randomUUID();
      const cancel = () => {
        this.api.cancelThumbnail(requestId).catch(() => {
          /* Already closed or replaced. */
        });
      };
      signal.addEventListener('abort', cancel, { once: true });
      try {
        const result = await this.api.requestThumbnail({ entryId, preset: 'grid', requestId });
        if (result.status === 'ready' || result.status === 'unsupported') {
          remember(this.thumbnails, entryId, result, 512);
        }
        return result;
      } finally {
        signal.removeEventListener('abort', cancel);
      }
    }, signal);
  }

  refresh() {
    this.dispose();
    this.id = crypto.randomUUID();
    this.directories.clear();
    this.summaries.clear();
    this.thumbnails.clear();
  }

  dispose() {
    this.gallery?.close();
  }
}
