import type { Activity } from '#activity';
import { errorMessage } from '#errors';
import type { FolderChange, FolderContents, LibraryUpdate, PhotoEntry, ReadError } from '#photos';
import type { Rating } from '#ratings';
import type { ScreenContents } from '#screen-contents';
import type { ThumbnailResult, ThumbnailStillImage, ThumbnailUpdate } from '#thumbnails';
import type {
  PrismTrash,
  TrashChoices,
  TrashCounts,
  TrashDestination,
  TrashFileList,
  TrashLocation,
  TrashPlan,
  TrashProgress,
  TrashRunSummary,
  TrashUndoSummary,
} from '#trash';
import type { SerializedTreeListing } from '#tree-listing';
import type { ViewFacets, ViewSpec, ViewState } from '#views';
import type { Debugger } from 'obug';

/**
 * What the window asks the library's worker directly, over the message port the main process
 * hands it when the library opens. The worker checks every argument.
 */
export interface PhotoWorkerAPI {
  listFolder: (directoryId: string) => Promise<FolderContents>;
  listSubfolders: (parentIds: string[]) => Promise<SerializedTreeListing>;
  listFoldersById: (folderIds: string[]) => Promise<SerializedTreeListing>;
  /** Returns text from `treeListingToText`, as `PhotosAPI.listWholeTree` explains. */
  listWholeTree: () => Promise<string>;
  reportScreenContents: (contents: ScreenContents) => Promise<void>;
  /** Forgets what the worker knows of the library's folders, so the next reads see them afresh. */
  refresh: () => void;
  storeThumbnail: (stillImage: ThumbnailStillImage) => Promise<ThumbnailResult>;
  rename: (
    entryId: string,
    name: string,
  ) => Promise<{ entry: PhotoEntry; changes: FolderChange[] }>;
  /** Rates an entry, or removes its rating with `null`. Resolves with the entry as rated. */
  rate: (entryId: string, rating: Rating | null) => Promise<PhotoEntry>;
  openView: (spec: ViewSpec) => Promise<ViewState>;
  viewRows: (
    viewId: string,
    version: number,
    start: number,
    count: number,
  ) => Promise<PhotoEntry[] | null>;
  viewIndexOf: (viewId: string, version: number, entryId: string) => Promise<number | null>;
  viewFacets: (viewId: string) => Promise<ViewFacets>;
  viewTrashPlan: (
    viewId: string,
    version: number,
    choices: TrashChoices,
  ) => Promise<TrashPlan | null>;
  viewTrashFiles: (
    viewId: string,
    version: number,
    choices: TrashChoices,
  ) => Promise<TrashFileList | null>;
  getTrashLocation: () => Promise<TrashLocation>;
  /**
   * Carries out the plan that `viewTrashPlan` makes from the same arguments. Rejects if that
   * version of the view is gone, or if the plan no longer goes to `destination`.
   */
  trashView: (
    viewId: string,
    version: number,
    choices: TrashChoices,
    destination: TrashDestination,
  ) => Promise<TrashRunSummary>;
  /** Puts back what a run moved. */
  undoTrash: (runId: string) => Promise<TrashUndoSummary>;
  prismTrash: () => Promise<PrismTrash | null>;
  prismTrashContents: (batchId: string) => Promise<TrashCounts>;
  putBackTrashBatch: (batchId: string) => Promise<TrashUndoSummary>;
  deleteTrashBatch: (batchId: string) => Promise<void>;
  emptyPrismTrash: () => Promise<void>;
  viewErrors: (viewId: string) => Promise<ReadError[]>;
  closeView: (viewId: string) => Promise<void>;
}

/**
 * Everything the worker can do: the window's methods, plus those only the main process may
 * call, to find files and to convert photos the window cannot decode.
 */
export type PhotoBackend = PhotoWorkerAPI & {
  /** Finds an entry's path on disk, after checking it is inside the library's folder. */
  resolve: (entryId: string) => Promise<string>;
  /** The path of the file of the photo or video `entryId`. */
  original: (entryId: string) => Promise<string>;
  /** A full-size image of the photo `entryId`, for one that `needsConversion`, and its media type. */
  convertedOriginal: (entryId: string) => Promise<{ data: Uint8Array; type: string }>;
  /** The name of `entryId`'s cached thumbnail, or `null` if it has none yet. It never makes one. */
  cachedThumbnail: (entryId: string) => Promise<string | null>;
  /**
   * Starts reading every folder of the library again in full, in the background, unless such a
   * read is already running. Resolves at once.
   */
  readEveryFolder: () => Promise<void>;
  /**
   * Forgets every photo's details in the catalog, so each is read again, through the library's
   * own catalog writer. Resolves once that write is in.
   */
  forgetDetails: () => Promise<void>;
  /** As the app quits, saves the manifests of runs to Prism's Trash under way, then each item. */
  saveOpenTrashBatches: () => Promise<void>;
};

/**
 * The worker asks the main process for a still image of a video, as only the main process can reach
 * the system's tools that render one.
 */
export interface StillImageRequest {
  kind: 'stillImageRequest';
  stillImage: { id: number; source: string; width: number; height: number };
}
/** The main process's answer to a `StillImageRequest` with the same `id`. */
export interface StillImageResponse {
  kind: 'stillImageResponse';
  stillImage: { id: number } & (
    | { kind: 'image'; image: Uint8Array }
    | { kind: 'error'; error: string }
  );
}

/**
 * The methods the worker answers when the window calls. The main process may call the rest of
 * `PhotoBackend` too.
 */
export const WINDOW_METHODS: ReadonlySet<string> = new Set([
  'closeView',
  'deleteTrashBatch',
  'emptyPrismTrash',
  'getTrashLocation',
  'listFolder',
  'listFoldersById',
  'listSubfolders',
  'listWholeTree',
  'openView',
  'prismTrash',
  'prismTrashContents',
  'putBackTrashBatch',
  'rate',
  'refresh',
  'rename',
  'reportScreenContents',
  'storeThumbnail',
  'trashView',
  'undoTrash',
  'viewErrors',
  'viewFacets',
  'viewIndexOf',
  'viewRows',
  'viewTrashFiles',
  'viewTrashPlan',
] satisfies (keyof PhotoWorkerAPI)[]);

/** A call to a method in another thread or process, which answers it with `serve`. */
export interface WorkerRequest {
  /** Matches the response to its call. */
  id: number;
  method: string;
  args: unknown[];
}
/** What a call returned, or the message of what it threw. */
export type WorkerResponse =
  | { kind: 'value'; id: number; value: unknown }
  | { kind: 'error'; id: number; error: string };
/**
 * What the worker sends the window without being asked. It shares the port with responses to
 * calls, so each `kind` differs from theirs.
 */
export type WorkerEvent =
  /** An update of the library. */
  | { kind: 'update'; update: LibraryUpdate }
  /** Entries whose contents are out of date, sent ahead of the update that includes them. */
  | { kind: 'stale'; entryIds: string[] }
  /** A thumbnail of an entry on screen. */
  | { kind: 'thumbnail'; thumbnail: ThumbnailUpdate }
  /** How far a run to the Trash has got. */
  | { kind: 'trashProgress'; progress: TrashProgress }
  /** What the worker is busy with. */
  | { kind: 'activity'; activity: Activity };

/**
 * Calls the method of `api` that `request` names, and returns the response a `WorkerClient` on
 * the other side waits for: what the method returned, once settled, or what it threw.
 * `allowed`, if given, limits which methods the caller may use. The method starts at once, so
 * requests start in the order they arrive.
 */
export async function serve(
  api: object,
  request: WorkerRequest,
  allowed?: ReadonlySet<string>,
): Promise<WorkerResponse> {
  try {
    const method: unknown = Reflect.get(api, request.method);
    if ((allowed && !allowed.has(request.method)) || typeof method !== 'function') {
      throw new Error(`${request.method} cannot be called here.`);
    }
    // Calls the method with `api` as its `this`, as `api[request.method](...args)` would.
    return { id: request.id, kind: 'value', value: await Reflect.apply(method, api, request.args) };
  } catch (error) {
    return { error: errorMessage(error), id: request.id, kind: 'error' };
  }
}

/** A `WorkerClient` can only call methods, so every member of its API must be one. */
type Methods<API> = { [Method in keyof API]: (...args: never[]) => unknown };

/**
 * Calls methods in another thread or process by sending messages, and matches each response to
 * its call. The other side answers with `serve`.
 */
export class WorkerClient<API extends Methods<API>> {
  private nextId = 0;
  /** Why the client was closed, which every later call fails with; `null` while it is open. */
  private closedReason: string | null = null;
  /** The calls still waiting for their responses, by ID. */
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();

  /**
   * `post` sends a request. Pass each response to `receive`. `log`, when turned on, logs each
   * call with its arguments and how long its answer took, including time spent waiting.
   */
  constructor(
    private readonly post: (request: WorkerRequest) => void,
    private readonly log?: Debugger,
  ) {}

  call<Method extends keyof API & string>(
    method: Method,
    ...args: Parameters<API[Method]>
  ): Promise<Awaited<ReturnType<API[Method]>>> {
    if (this.closedReason !== null) {
      return Promise.reject(new Error(this.closedReason));
    }
    const id = this.nextId;
    this.nextId += 1;
    const response = Promise.withResolvers<Awaited<ReturnType<API[Method]>>>();
    this.pending.set(id, {
      reject: response.reject,
      resolve: (value) => response.resolve(value as Awaited<ReturnType<API[Method]>>),
    });
    try {
      this.post({ args, id, method });
    } catch (error) {
      this.pending.delete(id);
      response.reject(error);
    }
    const { log } = this;
    if (!log?.enabled) {
      return response.promise;
    }
    const start = Date.now();
    const took = () => Date.now() - start;
    return response.promise.then(
      (value) => {
        log('%s %o %dms', method, args, took());
        return value;
      },
      (error: unknown) => {
        log('%s %o failed after %dms: %s', method, args, took(), String(error));
        throw error;
      },
    );
  }

  /** Settles the call that `response` answers. */
  receive(response: WorkerResponse): void {
    const pending = this.pending.get(response.id);
    this.pending.delete(response.id);
    switch (response.kind) {
      case 'value': {
        pending?.resolve(response.value);
        break;
      }
      case 'error': {
        pending?.reject(new Error(response.error));
        break;
      }
      // No default
    }
  }

  /** Fails the calls still waiting, and every later one, with `reason`. */
  close(reason: string): void {
    this.closedReason = reason;
    for (const pending of this.pending.values()) {
      pending.reject(new Error(reason));
    }
    this.pending.clear();
  }
}
