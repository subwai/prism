import { requireAttention, requireFolderIds, requireString } from '#photos/validate';
import type { PhotoLibrary } from '#photos/worker/library';
import { rateEntry } from '#photos/worker/rating';
import { renameEntry } from '#photos/worker/rename';
import { VISIBLE } from '#photos/worker/scheduler';
import { type TrashService, trashService } from '#photos/worker/trash-service';
import { ready, WindowWork } from '#photos/worker/window-work';
import {
  type Conversions,
  conversions,
  type ConvertedPhoto,
  convertedPhoto,
  type FrameReader,
  generateThumbnail,
  hasThumbnail,
  listedThumbnailKey,
  mediaKind,
  type ThumbnailCache,
  thumbnailCache,
  thumbnailKey,
} from '@prism/media';
import type {
  Attention,
  FolderChange,
  FolderListing,
  FolderSkeleton,
  PhotoBackend,
  PhotoEntry,
  PrismTrash,
  Rating,
  ReadError,
  ThumbnailFrame,
  ThumbnailResult,
  TrashChoices,
  TrashCounts,
  TrashDestination,
  TrashFiles,
  TrashPlace,
  TrashPlan,
  TrashProgress,
  TrashRunResult,
  TrashUndoResult,
  ViewFacets,
  ViewSpec,
  ViewState,
} from '@prism/shared';

const MAX_FRAME_BYTES = 32 * 1024 * 1024;

/**
 * What a folder's worker does for its windows and the main process. `frame` reads video stills
 * from the system; the window takes the ones it cannot. It reads thumbnails of HEIF photos too,
 * which only the system decodes. `trashing` hears how far a run to the Trash has got. Its public methods are what `serve` answers, so what it keeps
 * to itself uses `#` private members.
 */
export class WorkerBackend implements PhotoBackend {
  readonly #library: PhotoLibrary;
  readonly #cache: ThumbnailCache;
  readonly #work: WindowWork;
  readonly #conversions: Conversions;
  readonly #trash: TrashService;

  constructor(
    library: PhotoLibrary,
    cacheDirectory: string,
    frame?: FrameReader,
    trashing?: (progress: TrashProgress) => void,
  ) {
    const { scheduler } = library;
    this.#library = library;
    this.#trash = trashService(library, trashing);
    this.#cache = thumbnailCache(cacheDirectory);
    this.#work = new WindowWork({ cache: this.#cache, frame, library });
    this.#conversions = conversions((key, work) => scheduler.run('conversion', key, VISIBLE, work));
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

  requestThumbnail(entryId: string): Promise<ThumbnailResult> {
    requireString(entryId);
    return this.#work.request(entryId);
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

  attend(attention: Attention): Promise<void> {
    requireAttention(attention);
    this.#work.attend(attention);
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
    this.#work.forget();
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
