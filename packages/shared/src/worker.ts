import { errorMessage } from '#errors';
import type {
  FolderChange,
  FolderListing,
  FolderSummary,
  LibraryUpdate,
  PhotoEntry,
  ReadError,
  ThumbnailFrame,
  ThumbnailResult,
} from '#photos';
import type { Rating } from '#ratings';
import type {
  PrismTrash,
  TrashChoices,
  TrashCounts,
  TrashFiles,
  TrashPlan,
  TrashProgress,
  TrashRunResult,
  TrashUndoResult,
} from '#trash';
import type { ViewFacets, ViewSpec, ViewState } from '#views';
import type { Debugger } from 'obug';

/**
 * What the window asks its folder's worker directly, over the message port the main process
 * gives it when the folder opens. The worker checks every argument.
 */
export interface PhotoWorkerAPI {
  listFolder: (directoryId: string) => Promise<FolderListing>;
  inspectFolder: (directoryId: string) => Promise<FolderSummary>;
  /** Forgets what the worker remembers of folders, so the next reads see them afresh. */
  refresh: () => void;
  requestThumbnail: (entryId: string) => Promise<ThumbnailResult>;
  storeThumbnail: (frame: ThumbnailFrame) => Promise<ThumbnailResult>;
  rename: (
    entryId: string,
    name: string,
  ) => Promise<{ entry: PhotoEntry; changes: FolderChange[] }>;
  /** Rates an entry, or with `null` takes its rating away; resolves with it as rated. */
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
  ) => Promise<TrashFiles | null>;
  /** Runs the plan `viewTrashPlan` makes of the same arguments; rejects if that version has gone. */
  trashView: (viewId: string, version: number, choices: TrashChoices) => Promise<TrashRunResult>;
  /** Puts back what a run moved. */
  undoTrash: (runId: string) => Promise<TrashUndoResult>;
  prismTrash: () => Promise<PrismTrash | null>;
  prismTrashContents: (batchId: string) => Promise<TrashCounts>;
  putBackTrashBatch: (batchId: string) => Promise<TrashUndoResult>;
  deleteTrashBatch: (batchId: string) => Promise<void>;
  emptyPrismTrash: () => Promise<void>;
  viewErrors: (viewId: string) => Promise<ReadError[]>;
  closeView: (viewId: string) => Promise<void>;
}

/**
 * What the worker does: the window's methods, plus resolving files and converting the photos
 * the window cannot read for the main process.
 */
export type PhotoBackend = PhotoWorkerAPI & {
  /** Finds an entry on disk, checking it is inside the folder. */
  resolve: (entryId: string) => Promise<string>;
  /** The file of the photo or video `entryId`. */
  original: (entryId: string) => Promise<string>;
  /** A full-size image of the photo `entryId`, if it `needsConversion`, and its media type. */
  convertedOriginal: (entryId: string) => Promise<{ data: Uint8Array; type: string }>;
  /** The name of `entryId`'s cached thumbnail, or `null` if it has none yet; it makes none. */
  cachedThumbnail: (entryId: string) => Promise<string | null>;
};

/** The worker asks the main process for video stills, which only it can render. */
export interface FrameRequest {
  frame: { id: number; source: string; width: number; height: number };
}
export interface FrameResponse {
  frame: { id: number } & ({ image: Uint8Array } | { error: string });
}

/** The worker answers the window only these, and the main process the rest too. */
export const WORKER_METHODS: ReadonlySet<string> = new Set([
  'closeView',
  'deleteTrashBatch',
  'emptyPrismTrash',
  'inspectFolder',
  'listFolder',
  'openView',
  'prismTrash',
  'prismTrashContents',
  'putBackTrashBatch',
  'rate',
  'refresh',
  'rename',
  'requestThumbnail',
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

export interface WorkerRequest {
  id: number;
  method: string;
  args: unknown[];
}
export type WorkerResponse = { id: number; value: unknown } | { id: number; error: string };
/**
 * What the worker tells the window unasked: an update of the library, or, ahead of it, which
 * entries' contents are out of date; or how far a run to the Trash has got.
 */
export type WorkerEvent = LibraryUpdate | { stale: string[] } | { trashing: TrashProgress };

/**
 * Answers `request` with `api`'s method of its name, as a `WorkerClient` on the other side waits
 * for: what it returned, once settled, or what it threw. `allowed`, if given, limits which
 * methods the caller may use. The method runs at once, so requests run in the order they came.
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
    return { id: request.id, value: await Reflect.apply(method, api, request.args) };
  } catch (error) {
    return { error: errorMessage(error), id: request.id };
  }
}

type Methods<API> = { [Method in keyof API]: (...args: never[]) => unknown };

/** Calls a worker's methods with messages, matching each response to its call. */
export class WorkerClient<API extends Methods<API>> {
  private sequence = 0;
  private closed: string | null = null;
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();

  /**
   * `post` sends a request; pass each response to `receive`. `log`, when on, logs each call
   * with what it was asked and how long its answer took, waiting included.
   */
  constructor(
    private readonly post: (request: WorkerRequest) => void,
    private readonly log?: Debugger,
  ) {}

  call<Method extends keyof API & string>(
    method: Method,
    ...args: Parameters<API[Method]>
  ): Promise<Awaited<ReturnType<API[Method]>>> {
    if (this.closed !== null) {
      return Promise.reject(new Error(this.closed));
    }
    const id = this.sequence;
    this.sequence += 1;
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

  receive(response: WorkerResponse): void {
    const pending = this.pending.get(response.id);
    this.pending.delete(response.id);
    if ('error' in response) {
      pending?.reject(new Error(response.error));
    } else {
      pending?.resolve(response.value);
    }
  }

  /** Fails the calls still waiting, and every later one, with `reason`. */
  close(reason: string): void {
    this.closed = reason;
    for (const pending of this.pending.values()) {
      pending.reject(new Error(reason));
    }
    this.pending.clear();
  }
}
