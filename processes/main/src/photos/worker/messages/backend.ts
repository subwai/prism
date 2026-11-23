import { requireFolderIds, requireScreenContents, requireString } from '#photos/validate';
import { rateEntry } from '#photos/worker/edits/rating';
import { renameEntry } from '#photos/worker/edits/rename';
import type { PhotoLibrary } from '#photos/worker/library/library';
import {
  findCachedThumbnail,
  storeVideoStillImage,
} from '#photos/worker/on-screen/cached-thumbnails';
import { WindowWork } from '#photos/worker/on-screen/window-work';
import { ALWAYS_VISIBLE } from '#photos/worker/scheduler/scheduler';
import { type TrashService, trashService } from '#photos/worker/trash/trash-service';
import {
  type Conversions,
  conversions,
  type ConvertedPhoto,
  convertedPhoto,
  type StillImageReader,
  type ThumbnailCache,
  thumbnailCache,
} from '@prism/media';
import type {
  FolderChange,
  FolderContents,
  PhotoBackend,
  PhotoEntry,
  PrismTrash,
  Rating,
  ReadError,
  ScreenContents,
  SerializedTreeListing,
  ThumbnailResult,
  ThumbnailStillImage,
  TrashChoices,
  TrashCounts,
  TrashDestination,
  TrashFileList,
  TrashLocation,
  TrashPlan,
  TrashRunSummary,
  TrashUndoSummary,
  ViewFacets,
  ViewSpec,
  ViewState,
  WorkerEvent,
} from '@prism/shared';

// Facets are the values a view can be filtered by, such as its cameras, with how many photos have
// each.

const MAX_STILL_IMAGE_BYTES = 32 * 1024 * 1024;

/**
 * What a library worker does for its windows and the main process.
 * - `stillImage` reads video still images from the system, and the window takes the ones it
 *   cannot. It reads thumbnails of HEIF photos too, which only the system decodes.
 * - `sendEvent` sends the window, without being asked, the thumbnails of the entries it shows
 *   and how far a run to the Trash has got.
 * Its public methods are the ones `serve` answers, so everything else is a `#` private member.
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
    stillImage?: StillImageReader,
    sendEvent: (event: WorkerEvent) => void = () => null,
  ) {
    const { scheduler } = library;
    this.#library = library;
    this.#trash = trashService(library, (progress) =>
      sendEvent({ kind: 'trashProgress', progress }),
    );
    this.#cache = thumbnailCache(cacheDirectory);
    this.#work = new WindowWork({
      cache: this.#cache,
      library,
      sendThumbnail: (thumbnail) => sendEvent({ kind: 'thumbnail', thumbnail }),
      stillImage,
    });
    this.#conversions = conversions((key, work) =>
      scheduler.run('conversion', key, ALWAYS_VISIBLE, work),
    );
  }

  /** The key of the entry's thumbnail if it is cached; see `findCachedThumbnail`. */
  async cachedThumbnail(entryId: string): Promise<string | null> {
    requireString(entryId);
    return await findCachedThumbnail(this.#library, this.#cache, entryId);
  }

  /** Makes a video's thumbnail from a still image the window took; see `storeVideoStillImage`. */
  async storeThumbnail(stillImage: ThumbnailStillImage): Promise<ThumbnailResult> {
    if (
      !stillImage ||
      typeof stillImage !== 'object' ||
      !(stillImage.image instanceof Uint8Array) ||
      stillImage.image.byteLength > MAX_STILL_IMAGE_BYTES
    ) {
      throw new Error('Invalid video still image.');
    }
    requireString(stillImage.entryId);
    return await storeVideoStillImage(this.#library, this.#cache, stillImage);
  }

  /** A conversion of the HEIF or TIFF photo `entryId`, which the window cannot read itself. */
  async convertedOriginal(entryId: string): Promise<ConvertedPhoto> {
    return convertedPhoto(this.#conversions, await this.#library.openMediaFile(entryId));
  }

  reportScreenContents(contents: ScreenContents): Promise<void> {
    requireScreenContents(contents);
    this.#work.updateScreen(contents);
    return Promise.resolve();
  }

  closeView(viewId: string): Promise<void> {
    return this.#library.views.close(viewId);
  }

  listFolder(directoryId: string): Promise<FolderContents> {
    return this.#library.listFolder(directoryId);
  }

  listSubfolders(parentIds: string[]): Promise<SerializedTreeListing> {
    requireFolderIds(parentIds);
    return this.#library.listSubfolders(parentIds);
  }

  listFoldersById(folderIds: string[]): Promise<SerializedTreeListing> {
    requireFolderIds(folderIds);
    return this.#library.listFoldersById(folderIds);
  }

  listWholeTree(): Promise<string> {
    return this.#library.listWholeTree();
  }

  openView(spec: ViewSpec): Promise<ViewState> {
    return this.#library.views.open(spec);
  }

  original(entryId: string): Promise<string> {
    return this.#library.original(entryId);
  }

  rate(entryId: string, rating: Rating | null): Promise<PhotoEntry> {
    return rateEntry({ cache: this.#cache, entryId, library: this.#library, stars: rating });
  }

  /**
   * Finds or makes again the thumbnails of entries on screen whose contents changed, after the
   * window was sent word that they are stale; see `reportChanges`. The window cannot call it.
   */
  remakeStaleThumbnails(entryIds: string[]): void {
    this.#work.remakeStaleThumbnails(entryIds);
  }

  readEveryFolder(): Promise<void> {
    this.#library.readEveryFolder().catch(() => null);
    return Promise.resolve();
  }

  forgetDetails(): Promise<void> {
    return this.#library.views.forgetDetails();
  }

  refresh(): void {
    this.#library.forget();
    this.#work.startOver();
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
  ): Promise<TrashFileList | null> {
    return this.#library.trashPlans.files(viewId, version, choices);
  }

  viewTrashPlan(viewId: string, version: number, choices: TrashChoices): Promise<TrashPlan | null> {
    return this.#library.trashPlans.plan(viewId, version, choices);
  }

  getTrashLocation(): Promise<TrashLocation> {
    return this.#trash.getTrashLocation();
  }

  trashView(
    viewId: string,
    version: number,
    choices: TrashChoices,
    destination: TrashDestination,
  ): Promise<TrashRunSummary> {
    return this.#trash.trashView(viewId, version, choices, destination);
  }

  undoTrash(runId: string): Promise<TrashUndoSummary> {
    return this.#trash.undoTrash(runId);
  }

  prismTrash(): Promise<PrismTrash | null> {
    return this.#trash.prismTrash();
  }

  prismTrashContents(batchId: string): Promise<TrashCounts> {
    return this.#trash.prismTrashContents(batchId);
  }

  putBackTrashBatch(batchId: string): Promise<TrashUndoSummary> {
    return this.#trash.putBackTrashBatch(batchId);
  }

  deleteTrashBatch(batchId: string): Promise<void> {
    return this.#trash.deleteTrashBatch(batchId);
  }

  emptyPrismTrash(): Promise<void> {
    return this.#trash.emptyPrismTrash();
  }
}
