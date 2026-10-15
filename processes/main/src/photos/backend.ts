import { errorMessage, type PhotoLibrary, requireString } from '#photos/library';
import { ThumbnailCache } from '#photos/thumbnails';
import { WorkQueue } from '#photos/work-queue';
import type { FolderSummary, ScanOptions, ThumbnailRequest, ThumbnailResult } from '@app/shared';

const INSPECTION_CONCURRENCY = 4,
  MAX_REQUESTS = 128,
  THUMBNAIL_CONCURRENCY = 2;

export type PhotoBackend = Pick<
  PhotoLibrary,
  'cancelScan' | 'inspectFolder' | 'nextBatch' | 'original'
> & {
  cancelThumbnail: (requestId: string) => void;
  requestThumbnail: (request: ThumbnailRequest) => Promise<ThumbnailResult>;
  startScan: (options: ScanOptions) => string;
};

export function createPhotoBackend(library: PhotoLibrary, cacheDirectory: string): PhotoBackend {
  const cache = new ThumbnailCache(cacheDirectory),
    thumbnails = new WorkQueue<string>(THUMBNAIL_CONCURRENCY, MAX_REQUESTS),
    inspections = new WorkQueue<FolderSummary>(INSPECTION_CONCURRENCY, MAX_REQUESTS),
    requests = new Map<string, AbortController>();

  async function requestThumbnail(request: ThumbnailRequest): Promise<ThumbnailResult> {
    if (!request || typeof request !== 'object') {
      throw new Error('Invalid thumbnail request.');
    }
    requireString(request.requestId);
    requireString(request.entryId);
    if (request.preset !== 'grid') {
      return { status: 'unsupported' };
    }
    if (requests.has(request.requestId) || requests.size >= MAX_REQUESTS) {
      throw new Error('Thumbnail request limit reached or request ID already in use.');
    }
    const controller = new AbortController();
    requests.set(request.requestId, controller);
    try {
      const source = await library.original(request.entryId);
      controller.signal.throwIfAborted();
      const key = await thumbnails.run(source, controller.signal, (signal) =>
        cache.generate(source, signal)
      );
      controller.signal.throwIfAborted();
      return { status: 'ready', url: `media://thumbnail/${key}.webp` };
    } catch (error) {
      return controller.signal.aborted
        ? { status: 'cancelled' }
        : { message: errorMessage(error), status: 'failed' };
    } finally {
      requests.delete(request.requestId);
    }
  }

  return {
    cancelScan: (scanId: string) => library.cancelScan(scanId),
    cancelThumbnail(requestId: string): void {
      requireString(requestId);
      const controller = requests.get(requestId);
      if (controller) {
        controller.abort();
      }
    },
    inspectFolder(directoryId: string): Promise<FolderSummary> {
      requireString(directoryId);
      return inspections.run(directoryId, library.controller.signal, () =>
        library.inspectFolder(directoryId)
      );
    },
    nextBatch: (scanId: string) => library.nextBatch(scanId),
    original: (entryId: string) => library.original(entryId),
    requestThumbnail,
    startScan: (options: Parameters<PhotoLibrary['startScan']>[0]) => library.startScan(options)
  };
}

export interface BackendRequest {
  id: number;
  method: keyof PhotoBackend;
  args: unknown[];
}
export type BackendResponse = { id: number; value: unknown } | { id: number; error: string };
