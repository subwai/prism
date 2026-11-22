import { requireAttention, requireFolderIds, requireString } from '#photos/validate';
import { rateEntry } from '#photos/worker/edits/rating';
import { renameEntry } from '#photos/worker/edits/rename';
import type { PhotoLibrary } from '#photos/worker/library';
import { ready, WindowWork } from '#photos/worker/on-screen/window-work';
import { ALWAYS_VISIBLE } from '#photos/worker/scheduler/scheduler';
import { type TrashService, trashService } from '#photos/worker/trash/trash-service';
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
  FolderChange,
  FolderListing,
  PhotoBackend,
  PhotoEntry,
  PrismTrash,
  Rating,
  ReadError,
  ScreenContents,
  ThumbnailFrame,
  ThumbnailResult,
  TrashChoices,
  TrashCounts,
  TrashDestination,
  TrashFileList,
  TrashLocation,
  TrashPlan,
  TrashRunSummary,
  TrashUndoSummary,
  TreeListing,
  ViewFacets,
  ViewSpec,
  ViewState,
  WorkerEvent,
} from '@prism/shared';

const MAX_FRAME_BYTES = 32 * 1024 * 1024;

/**
 * What a folder's worker does for its windows and the main process. `frame` reads video stills
 * from the system; the window takes the ones it cannot. It reads thumbnails of HEIF photos too,
 * which only the system decodes. `tell` tells the window, unasked, the thumbnails of the entries
 * it shows and how far a run to the Trash has got. Its public methods are what `serve` answers,
 * so what it keeps to itself uses `#` private members.
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
    tell: (event: WorkerEvent) => void = () => null,
  ) {
    const { scheduler } = library;
    this.#library = library;
    this.#trash = trashService(library, (progress) => tell({ kind: 'trashProgress', progress }));
    this.#cache = thumbnailCache(cacheDirectory);
    this.#work = new WindowWork({
      cache: this.#cache,
      frame,
      library,
      tell: (thumbnail) => tell({ kind: 'thumbnail', thumbnail }),
    });
    this.#conversions = conversions((key, work) =>
      scheduler.run('conversion', key, ALWAYS_VISIBLE, work),
    );
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
    await generateThumbnail(this.#cache, source, key, this.#library.signal, {
      frame: () => Promise.resolve(still.image),
    });
    return ready(key);
  }

  /** A conversion of the HEIF or TIFF photo `entryId`, which the window cannot read itself. */
  async convertedOriginal(entryId: string): Promise<ConvertedPhoto> {
    return convertedPhoto(this.#conversions, await this.#library.open(entryId));
  }

  reportScreenContents(attention: ScreenContents): Promise<void> {
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

  listSubfolders(parentIds: string[]): Promise<TreeListing> {
    requireFolderIds(parentIds);
    return this.#library.listSubfolders(parentIds);
  }

  listFoldersById(folderIds: string[]): Promise<TreeListing> {
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
    return rateEntry(this.#library, this.#cache, entryId, rating);
  }

  /**
   * Has the thumbnails of entries on show whose contents changed found or made again, once the
   * window has been told they are stale; see `reportChanges`. The window cannot call it.
   */
  stale(entryIds: string[]): void {
    this.#work.stale(entryIds);
  }

  readEveryFolder(): Promise<void> {
    this.#library.readEveryFolder().catch(() => null);
    return Promise.resolve();
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
  ): Promise<TrashFileList | null> {
    return this.#library.trashPlans.files(viewId, version, choices);
  }

  viewTrashPlan(viewId: string, version: number, choices: TrashChoices): Promise<TrashPlan | null> {
    return this.#library.trashPlans.plan(viewId, version, choices);
  }

  getTrashLocation(): Promise<TrashLocation> {
    return this.#trash.trashPlace();
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
