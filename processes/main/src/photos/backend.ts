import { errorMessage } from '#photos/errors';
import { HeifConversions, heifThumbnails } from '#photos/heif';
import type { PhotoLibrary } from '#photos/library';
import { mediaKind, systemRendersVideo } from '#photos/media';
import { renameEntry } from '#photos/rename';
import {
  type FrameReader,
  ThumbnailCache,
  thumbnailKey,
  type ThumbnailSource,
} from '#photos/thumbnails';
import { requireString } from '#photos/validate';
import { WorkQueue } from '#photos/work-queue';
import {
  type FolderSummary,
  isHeif,
  type PhotoWorkerAPI,
  type ScanOptions,
  type ThumbnailFrame,
  type ThumbnailResult,
} from '@prism/shared';
import { availableParallelism } from 'node:os';
import sharp from 'sharp';

const INSPECTION_CONCURRENCY = 4,
  MAX_QUEUED = 256,
  // Sharp decodes each image on one thread; half the cores leaves the rest to the window.
  THUMBNAIL_CONCURRENCY = Math.max(2, Math.floor(availableParallelism() / 2)),
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
  return async (source, size, signal) => {
    const image = await reader(source, size, signal);
    if (!(await sharp(image).stats()).isOpaque) {
      throw new FrameNeededError('The system rendered an icon rather than a still.');
    }
    return image;
  };
}

function ready(key: string): ThumbnailResult {
  return { status: 'ready', url: `media://thumbnail/${key}.webp` };
}

/**
 * What the worker does: the window's methods, plus resolving files and converting HEIF photos
 * for the main process.
 */
export type PhotoBackend = PhotoWorkerAPI &
  Pick<PhotoLibrary, 'original' | 'resolve'> & {
    heifOriginal: (entryId: string) => Promise<Uint8Array>;
  };

/**
 * `frame` reads video stills from the system; the window takes the ones it cannot. It reads
 * thumbnails of HEIF photos too, which only the system decodes.
 */
export function createPhotoBackend(
  library: PhotoLibrary,
  cacheDirectory: string,
  frame?: FrameReader,
): PhotoBackend {
  const cache = new ThumbnailCache(cacheDirectory),
    { signal } = library.controller,
    thumbnails = new WorkQueue<void>(THUMBNAIL_CONCURRENCY, MAX_QUEUED, signal),
    inspections = new WorkQueue<FolderSummary>(INSPECTION_CONCURRENCY, MAX_QUEUED, signal),
    conversions = new HeifConversions(signal);

  /**
   * The still of a video comes from the system if it can render one, or else the window. HEIF
   * photos come from the system too, while sharp decodes every other photo itself.
   */
  function readerFor(source: ThumbnailSource): FrameReader | undefined {
    if (mediaKind(source.file) !== 'video') {
      return isHeif(source.file) ? heifThumbnails(frame) : undefined;
    }
    return frame && systemRendersVideo(source.file) ? stillsOnly(frame) : fromWindow;
  }

  async function requestThumbnail(entryId: string): Promise<ThumbnailResult> {
    requireString(entryId);
    try {
      const source = await library.open(entryId);
      const reader = readerFor(source);
      // A still the window stored earlier is cached like any other, so it is found first.
      const key = thumbnailKey(source, mediaKind(source.file) === 'video');
      // Cached thumbnails skip the queue, which only bounds decoding.
      if (!(await cache.has(key))) {
        await thumbnails.run(key, (workSignal) => cache.generate(source, key, workSignal, reader));
      }
      return ready(key);
    } catch (error) {
      if (error instanceof FrameNeededError) {
        return { status: 'frame-needed' };
      }
      return { message: errorMessage(error), status: 'failed' };
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
    const source = await library.open(still.entryId);
    if (mediaKind(source.file) !== 'video') {
      throw new Error('Only videos take their thumbnail from the window.');
    }
    const key = thumbnailKey(source, true);
    await cache.generate(source, key, signal, () => Promise.resolve(still.image));
    return ready(key);
  }

  /** A JPEG of the HEIF photo `entryId`, which the window cannot read itself. */
  async function heifOriginal(entryId: string): Promise<Uint8Array> {
    const source = await library.open(entryId);
    if (!isHeif(source.file)) {
      throw new Error('Only HEIF photos are converted.');
    }
    return conversions.jpeg(source);
  }

  return {
    cancelScan: (scanId: string) => library.cancelScan(scanId),
    heifOriginal,
    inspectFolder(directoryId: string): Promise<FolderSummary> {
      requireString(directoryId);
      return inspections.run(directoryId, () => library.inspectFolder(directoryId));
    },
    nextBatch: (scanId: string) => library.nextBatch(scanId),
    original: (entryId: string) => library.original(entryId),
    readExif: (entryIds: string[]) => library.readExif(entryIds),
    readMetadata: (entryIds: string[]) => library.readMetadata(entryIds),
    refresh: () => library.forget(),
    rename: (entryId: string, name: string) => renameEntry(library, entryId, name),
    requestThumbnail,
    resolve: (entryId: string) => library.resolve(entryId),
    startScan: (options: ScanOptions) => library.startScan(options),
    storeThumbnail,
  };
}

/** The worker asks the main process for video stills, which only it can render. */
export interface FrameRequest {
  frame: { id: number; source: string; width: number; height: number };
}
export interface FrameResponse {
  frame: { id: number } & ({ image: Uint8Array } | { error: string });
}
