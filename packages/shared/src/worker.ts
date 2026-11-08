import type {
  FolderChange,
  FolderChanges,
  FolderListing,
  FolderSummary,
  PhotoEntry,
  ThumbnailFrame,
  ThumbnailResult,
} from '#photos';
import type { ViewFacets, ViewSpec, ViewState } from '#views';

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
  openView: (spec: ViewSpec) => Promise<ViewState>;
  viewRows: (
    viewId: string,
    version: number,
    start: number,
    count: number,
  ) => Promise<PhotoEntry[] | null>;
  viewIndexOf: (viewId: string, version: number, entryId: string) => Promise<number>;
  viewFacets: (viewId: string) => Promise<ViewFacets>;
  closeView: (viewId: string) => Promise<void>;
}

/** The worker answers the window only these, and the main process the rest too. */
export const WORKER_METHODS: ReadonlySet<string> = new Set([
  'closeView',
  'inspectFolder',
  'listFolder',
  'openView',
  'refresh',
  'rename',
  'requestThumbnail',
  'storeThumbnail',
  'viewFacets',
  'viewIndexOf',
  'viewRows',
] satisfies (keyof PhotoWorkerAPI)[]);

export interface WorkerRequest {
  id: number;
  method: string;
  args: unknown[];
}
export type WorkerResponse = { id: number; value: unknown } | { id: number; error: string };
/** What the worker tells the window unasked: changes inside the folder, or to a view. */
export type WorkerEvent = { changes: FolderChanges } | { view: ViewState };

type Methods<API> = { [Method in keyof API]: (...args: never[]) => unknown };

/** Calls a worker's methods with messages, matching each response to its call. */
export interface WorkerClient<API extends Methods<API>> {
  call: <Method extends keyof API & string>(
    method: Method,
    ...args: Parameters<API[Method]>
  ) => Promise<Awaited<ReturnType<API[Method]>>>;
  receive: (response: WorkerResponse) => void;
  /** Fails the calls still waiting, and every later one, with `reason`. */
  close: (reason: string) => void;
}

/** `post` sends a request; pass each response to `receive`. */
export function createWorkerClient<API extends Methods<API>>(
  post: (request: WorkerRequest) => void,
): WorkerClient<API> {
  let sequence = 0;
  let closed: string | null = null;
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();

  function call<Method extends keyof API & string>(
    method: Method,
    ...args: Parameters<API[Method]>
  ): Promise<Awaited<ReturnType<API[Method]>>> {
    if (closed !== null) {
      return Promise.reject(new Error(closed));
    }
    const id = sequence;
    sequence += 1;
    const response = Promise.withResolvers<Awaited<ReturnType<API[Method]>>>();
    pending.set(id, {
      reject: response.reject,
      resolve: (value) => response.resolve(value as Awaited<ReturnType<API[Method]>>),
    });
    try {
      post({ args, id, method });
    } catch (error) {
      pending.delete(id);
      response.reject(error);
    }
    return response.promise;
  }

  return {
    call,
    close(reason) {
      closed = reason;
      for (const waiting of pending.values()) {
        waiting.reject(new Error(reason));
      }
      pending.clear();
    },
    receive(response) {
      const waiting = pending.get(response.id);
      pending.delete(response.id);
      if ('error' in response) {
        waiting?.reject(new Error(response.error));
      } else {
        waiting?.resolve(response.value);
      }
    },
  };
}
