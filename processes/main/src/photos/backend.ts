import { errorMessage, type PhotoLibrary, requireString } from '#photos/library';
import { mediaKind, systemRendersVideo } from '#photos/media';
import { type FrameReader, ThumbnailCache } from '#photos/thumbnails';
import { WorkQueue } from '#photos/work-queue';
import type {
  FolderSummary,
  ScanOptions,
  ThumbnailFrame,
  ThumbnailRequest,
  ThumbnailResult
} from '@app/shared';
import sharp from 'sharp';

const INSPECTION_CONCURRENCY = 4,
  MAX_REQUESTS = 128,
  THUMBNAIL_CONCURRENCY = 2,
  MAX_FRAME_BYTES = 32 * 1024 * 1024;

/** The window takes this video's still instead; see `storeThumbnail`. */
class FrameNeededError extends Error {
  override name = 'FrameNeededError';
}
const fromWindow: FrameReader = () =>
  Promise.reject(new FrameNeededError('The system cannot render a still of this video.'));

/**
 * Quick Look answers with the file's icon when it cannot render a still, rather than failing.
 * Stills are opaque and icons are not, so an icon sends the video to the window instead.
 */
function stillsOnly(reader: FrameReader): FrameReader {
  return async (source, edge, signal) => {
    const image = await reader(source, edge, signal);
    if (!(await sharp(image).stats()).isOpaque) {
      throw new FrameNeededError('The system rendered an icon rather than a still.');
    }
    return image;
  };
}

export type PhotoBackend = Pick<
  PhotoLibrary,
  'cancelScan' | 'inspectFolder' | 'nextBatch' | 'original' | 'resolve'
> & {
  cancelThumbnail: (requestId: string) => void;
  requestThumbnail: (request: ThumbnailRequest) => Promise<ThumbnailResult>;
  storeThumbnail: (frame: ThumbnailFrame) => Promise<ThumbnailResult>;
  startScan: (options: ScanOptions) => string;
};

/** `frame` reads video stills from the system; the window takes the ones it cannot. */
export function createPhotoBackend(
  library: PhotoLibrary,
  cacheDirectory: string,
  frame?: FrameReader
): PhotoBackend {
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
      let reader: FrameReader | undefined;
      if (mediaKind(source) === 'video') {
        reader = frame && systemRendersVideo(source) ? stillsOnly(frame) : fromWindow;
      }
      controller.signal.throwIfAborted();
      // A still the window stored earlier is cached like any other, so it is found first.
      const key = await thumbnails.run(source, controller.signal, (signal) =>
        cache.generate(source, signal, reader)
      );
      controller.signal.throwIfAborted();
      return { status: 'ready', url: `media://thumbnail/${key}.webp` };
    } catch (error) {
      if (error instanceof FrameNeededError) {
        return { status: 'frame-needed' };
      }
      return controller.signal.aborted
        ? { status: 'cancelled' }
        : { message: errorMessage(error), status: 'failed' };
    } finally {
      requests.delete(request.requestId);
    }
  }

  async function storeThumbnail(still: ThumbnailFrame): Promise<ThumbnailResult> {
    if (
      !still ||
      typeof still !== 'object' ||
      !(still.image instanceof Uint8Array) ||
      still.image.byteLength > MAX_FRAME_BYTES
    ) {
      throw new Error('Invalid video still.');
    }
    requireString(still.entryId);
    const source = await library.original(still.entryId);
    if (mediaKind(source) !== 'video') {
      throw new Error('Only videos take their thumbnail from the window.');
    }
    const key = await cache.generate(source, library.controller.signal, () =>
      Promise.resolve(still.image)
    );
    return { status: 'ready', url: `media://thumbnail/${key}.webp` };
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
    resolve: (entryId: string) => library.resolve(entryId),
    startScan: (options: Parameters<PhotoLibrary['startScan']>[0]) => library.startScan(options),
    storeThumbnail
  };
}

export interface BackendRequest {
  id: number;
  method: keyof PhotoBackend;
  args: unknown[];
}
export type BackendResponse = { id: number; value: unknown } | { id: number; error: string };

/** The worker asks the main process for video stills, which only it can render. */
export interface FrameRequest {
  frame: { id: number; source: string; edge: number };
}
export interface FrameResponse {
  frame: { id: number } & ({ image: Uint8Array } | { error: string });
}
