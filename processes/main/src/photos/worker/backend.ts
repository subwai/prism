import { requireString } from '#photos/validate';
import type { PhotoLibrary } from '#photos/worker/library';
import { rateEntry } from '#photos/worker/rating';
import { renameEntry } from '#photos/worker/rename';
import { FrameNeededError, fromWindow, stillsOnly } from '#photos/worker/stills';
import {
  type Conversions,
  conversions,
  type ConvertedPhoto,
  convertedPhoto,
  type FrameReader,
  generateThumbnail,
  hasThumbnail,
  heifThumbnail,
  mediaKind,
  systemRendersVideo,
  type ThumbnailCache,
  thumbnailCache,
  thumbnailKey,
  type ThumbnailSource,
  WorkQueue,
} from '@prism/media';
import {
  errorMessage,
  type FolderChange,
  type FolderListing,
  type FolderSummary,
  isHeif,
  type PhotoBackend,
  type PhotoEntry,
  type Rating,
  type ReadError,
  type ThumbnailFrame,
  type ThumbnailResult,
  type TrashChoices,
  type TrashFiles,
  type TrashPlan,
  type ViewFacets,
  type ViewSpec,
  type ViewState,
} from '@prism/shared';
import { availableParallelism } from 'node:os';

const INSPECTION_CONCURRENCY = 4,
  MAX_QUEUED = 256,
  // Sharp decodes each image on one thread; half the cores leaves the rest to the window.
  THUMBNAIL_CONCURRENCY = Math.max(2, Math.floor(availableParallelism() / 2)),
  MAX_FRAME_BYTES = 32 * 1024 * 1024;

function ready(key: string): ThumbnailResult {
  return { status: 'ready', url: `media://thumbnail/${key}.webp` };
}

/**
 * What a folder's worker does for its windows and the main process. `frame` reads video stills
 * from the system; the window takes the ones it cannot. It reads thumbnails of HEIF photos too,
 * which only the system decodes. Its public methods are what `serve` answers, so what it keeps
 * to itself uses `#` private members.
 */
export class WorkerBackend implements PhotoBackend {
  readonly #library: PhotoLibrary;
  readonly #frame: FrameReader | undefined;
  readonly #cache: ThumbnailCache;
  readonly #thumbnails: WorkQueue<unknown>;
  readonly #inspections: WorkQueue<FolderSummary>;
  readonly #conversions: Conversions;

  constructor(library: PhotoLibrary, cacheDirectory: string, frame?: FrameReader) {
    const { signal } = library;
    this.#library = library;
    this.#frame = frame;
    this.#cache = thumbnailCache(cacheDirectory);
    this.#thumbnails = new WorkQueue(THUMBNAIL_CONCURRENCY, MAX_QUEUED, signal);
    this.#inspections = new WorkQueue(INSPECTION_CONCURRENCY, MAX_QUEUED, signal);
    this.#conversions = conversions(signal);
    // What the window shows comes first; photos' details are read in the background around it.
    library.setBusy(() => this.#thumbnails.busy || this.#conversions.queue.busy);
  }

  /**
   * The still of a video comes from the system if it can render one, or else the window. A HEIF
   * photo's comes from the system's conversion the viewer shows, while sharp decodes every other
   * photo itself.
   */
  #readerFor(source: ThumbnailSource): FrameReader | undefined {
    const frame = this.#frame;
    if (mediaKind(source.file) !== 'video') {
      return isHeif(source.file) ? heifThumbnail : undefined;
    }
    return frame && systemRendersVideo(source.file) ? stillsOnly(frame) : fromWindow;
  }

  async cachedThumbnail(entryId: string): Promise<string | null> {
    requireString(entryId);
    const source = await this.#library.open(entryId);
    const key = thumbnailKey(source, mediaKind(source.file) === 'video');
    return (await hasThumbnail(this.#cache, key)) ? key : null;
  }

  async requestThumbnail(entryId: string): Promise<ThumbnailResult> {
    requireString(entryId);
    try {
      const source = await this.#library.open(entryId);
      const reader = this.#readerFor(source);
      // A still the window stored earlier is cached like any other, so it is found first.
      const key = thumbnailKey(source, mediaKind(source.file) === 'video');
      // Cached thumbnails skip the queue, which only bounds decoding.
      if (!(await hasThumbnail(this.#cache, key))) {
        await this.#thumbnails.run(key, (workSignal) =>
          generateThumbnail(this.#cache, source, key, workSignal, reader),
        );
      }
      return ready(key);
    } catch (error) {
      if (error instanceof FrameNeededError) {
        return { status: 'frame-needed' };
      }
      return { message: errorMessage(error), status: 'failed' };
    }
  }

  async storeThumbnail(still: ThumbnailFrame): Promise<ThumbnailResult> {
    if (
      !still ||
      typeof still !== 'object' ||
      !(still.image instanceof Uint8Array) ||
      still.image.byteLength > MAX_FRAME_BYTES
    ) {
      throw new Error('Invalid video still.');
    }
    requireString(still.entryId);
    const source = await this.#library.open(still.entryId);
    if (mediaKind(source.file) !== 'video') {
      throw new Error('Only videos take their thumbnail from the window.');
    }
    const key = thumbnailKey(source, true);
    await generateThumbnail(this.#cache, source, key, this.#library.signal, () =>
      Promise.resolve(still.image),
    );
    return ready(key);
  }

  /** A conversion of the HEIF or TIFF photo `entryId`, which the window cannot read itself. */
  async convertedOriginal(entryId: string): Promise<ConvertedPhoto> {
    return convertedPhoto(this.#conversions, await this.#library.open(entryId));
  }

  inspectFolder(directoryId: string): Promise<FolderSummary> {
    requireString(directoryId);
    return this.#inspections.run(directoryId, () => this.#library.inspectFolder(directoryId));
  }

  closeView(viewId: string): Promise<void> {
    return this.#library.views.close(viewId);
  }

  listFolder(directoryId: string): Promise<FolderListing> {
    return this.#library.listFolder(directoryId);
  }

  openView(spec: ViewSpec): Promise<ViewState> {
    return this.#library.views.open(spec);
  }

  original(entryId: string): Promise<string> {
    return this.#library.original(entryId);
  }

  rate(entryId: string, rating: Rating | null): Promise<PhotoEntry> {
    return rateEntry(this.#library, this.#cache, entryId, rating);
  }

  refresh(): void {
    this.#library.forget();
  }

  rename(entryId: string, name: string): Promise<{ entry: PhotoEntry; changes: FolderChange[] }> {
    return renameEntry(this.#library, entryId, name);
  }

  resolve(entryId: string): Promise<string> {
    return this.#library.resolve(entryId);
  }

  viewErrors(viewId: string): Promise<ReadError[]> {
    return Promise.resolve(this.#library.views.errors(viewId));
  }

  viewFacets(viewId: string): Promise<ViewFacets> {
    return this.#library.views.facets(viewId);
  }

  viewIndexOf(viewId: string, version: number, entryId: string): Promise<number | null> {
    return this.#library.views.indexOf(viewId, version, entryId);
  }

  viewRows(
    viewId: string,
    version: number,
    start: number,
    count: number,
  ): Promise<PhotoEntry[] | null> {
    return this.#library.views.rows(viewId, version, start, count);
  }

  viewTrashFiles(
    viewId: string,
    version: number,
    choices: TrashChoices,
  ): Promise<TrashFiles | null> {
    return this.#library.trashFiles(viewId, version, choices);
  }

  viewTrashPlan(viewId: string, version: number, choices: TrashChoices): Promise<TrashPlan | null> {
    return this.#library.trashPlan(viewId, version, choices);
  }
}
