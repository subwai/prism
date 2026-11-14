import { requireFolderIds, requireString } from '#photos/validate';
import type { PhotoLibrary } from '#photos/worker/library';
import { rateEntry } from '#photos/worker/rating';
import { renameEntry } from '#photos/worker/rename';
import { FrameNeededError, fromWindow, stillsOnly } from '#photos/worker/stills';
import { type TrashService, trashService } from '#photos/worker/trash-service';
import {
  type Conversions,
  conversions,
  type ConvertedPhoto,
  convertedPhoto,
  type FrameReader,
  generateThumbnail,
  hasThumbnail,
  heifThumbnail,
  listedThumbnailKey,
  mediaKind,
  systemRendersVideo,
  THUMBNAIL_CONCURRENCY,
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
  type FolderSkeleton,
  isHeif,
  type PhotoBackend,
  type PhotoEntry,
  type PrismTrash,
  type Rating,
  type ReadError,
  type ThumbnailFrame,
  type ThumbnailResult,
  type TrashChoices,
  type TrashCounts,
  type TrashDestination,
  type TrashFiles,
  type TrashPlace,
  type TrashPlan,
  type TrashProgress,
  type TrashRunResult,
  type TrashUndoResult,
  type ViewFacets,
  type ViewSpec,
  type ViewState,
} from '@prism/shared';

const TILE_READ_CONCURRENCY = 4;
const MAX_QUEUED = 256;
const MAX_FRAME_BYTES = 32 * 1024 * 1024;

function ready(key: string): ThumbnailResult {
  return { status: 'ready', url: `media://thumbnail/${key}.webp` };
}

/**
 * What a folder's worker does for its windows and the main process. `frame` reads video stills
 * from the system; the window takes the ones it cannot. It reads thumbnails of HEIF photos too,
 * which only the system decodes. `trashing` hears how far a run to the Trash has got. Its public methods are what `serve` answers, so what it keeps
 * to itself uses `#` private members.
 */
export class WorkerBackend implements PhotoBackend {
  readonly #library: PhotoLibrary;
  readonly #frame: FrameReader | undefined;
  readonly #cache: ThumbnailCache;
  readonly #thumbnails: WorkQueue<unknown>;
  readonly #tileReads: WorkQueue<void>;
  /** Folders whose tiles were read this session, which are kept current after that. */
  readonly #tilesRead = new Set<string>();
  readonly #conversions: Conversions;
  readonly #trash: TrashService;

  constructor(
    library: PhotoLibrary,
    cacheDirectory: string,
    frame?: FrameReader,
    trashing?: (progress: TrashProgress) => void,
  ) {
    const { signal } = library;
    this.#library = library;
    this.#frame = frame;
    this.#trash = trashService(library, trashing);
    this.#cache = thumbnailCache(cacheDirectory);
    this.#thumbnails = new WorkQueue(THUMBNAIL_CONCURRENCY, MAX_QUEUED, signal);
    this.#tileReads = new WorkQueue(TILE_READ_CONCURRENCY, MAX_QUEUED, signal);
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

  /**
   * The key of the entry's thumbnail if it is cached, named from the catalog's listing of the
   * file where it has one, so that showing a cached thumbnail asks nothing of the disk the
   * photo is on: on a network share busy with reads, each such call took long enough to see.
   */
  async cachedThumbnail(entryId: string): Promise<string | null> {
    requireString(entryId);
    const video = mediaKind(entryId) === 'video';
    const listed = await this.#library.listed(entryId);
    const key = listed
      ? listedThumbnailKey(listed, video)
      : thumbnailKey(await this.#library.open(entryId), video);
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

  readTiles(directoryIds: string[]): Promise<void> {
    requireFolderIds(directoryIds);
    for (const directoryId of directoryIds ?? []) {
      if (this.#tilesRead.has(directoryId)) {
        continue;
      }
      this.#tilesRead.add(directoryId);
      try {
        this.#tileReads
          .run(directoryId, () => this.#library.readTile(directoryId))
          // A tile that could not be read is read again once it is on show again.
          .catch(() => this.#tilesRead.delete(directoryId));
      } catch {
        // The queue is full: the folder is asked about again when next on show.
        this.#tilesRead.delete(directoryId);
      }
    }
    return Promise.resolve();
  }

  closeView(viewId: string): Promise<void> {
    return this.#library.views.close(viewId);
  }

  listFolder(directoryId: string): Promise<FolderListing> {
    return this.#library.listFolder(directoryId);
  }

  folderSkeleton(parentIds?: string[]): Promise<FolderSkeleton> {
    requireFolderIds(parentIds);
    return this.#library.folderSkeleton(parentIds);
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
    this.#tilesRead.clear();
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

  trashPlace(): Promise<TrashPlace> {
    return this.#trash.trashPlace();
  }

  trashView(
    viewId: string,
    version: number,
    choices: TrashChoices,
    destination: TrashDestination,
  ): Promise<TrashRunResult> {
    return this.#trash.trashView(viewId, version, choices, destination);
  }

  undoTrash(runId: string): Promise<TrashUndoResult> {
    return this.#trash.undoTrash(runId);
  }

  prismTrash(): Promise<PrismTrash | null> {
    return this.#trash.prismTrash();
  }

  prismTrashContents(batchId: string): Promise<TrashCounts> {
    return this.#trash.prismTrashContents(batchId);
  }

  putBackTrashBatch(batchId: string): Promise<TrashUndoResult> {
    return this.#trash.putBackTrashBatch(batchId);
  }

  deleteTrashBatch(batchId: string): Promise<void> {
    return this.#trash.deleteTrashBatch(batchId);
  }

  emptyPrismTrash(): Promise<void> {
    return this.#trash.emptyPrismTrash();
  }
}
