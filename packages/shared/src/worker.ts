import type {
  FolderChange,
  FolderChanges,
  FolderSummary,
  PhotoEntry,
  ScanBatch,
  ScanOptions,
  ThumbnailFrame,
  ThumbnailResult
} from '#photos';

/**
 * What the window asks its folder's worker directly, over the message port the main process
 * gives it when the folder opens. The worker checks every argument.
 */
export interface PhotoWorkerAPI {
  startScan: (options: ScanOptions) => string;
  nextBatch: (scanId: string) => Promise<ScanBatch>;
  cancelScan: (scanId: string) => Promise<void>;
  inspectFolder: (directoryId: string) => Promise<FolderSummary>;
  /** Forgets what the worker remembers of folders, so the next reads see them afresh. */
  refresh: () => void;
  requestThumbnail: (entryId: string) => Promise<ThumbnailResult>;
  storeThumbnail: (frame: ThumbnailFrame) => Promise<ThumbnailResult>;
  rename: (
    entryId: string,
    name: string
  ) => Promise<{ entry: PhotoEntry; changes: FolderChange[] }>;
}

/** The worker answers the window only these, and the main process the rest too. */
export const WORKER_METHODS: ReadonlySet<string> = new Set([
  'cancelScan',
  'inspectFolder',
  'nextBatch',
  'refresh',
  'rename',
  'requestThumbnail',
  'startScan',
  'storeThumbnail'
] satisfies (keyof PhotoWorkerAPI)[]);

export interface WorkerRequest {
  id: number;
  method: string;
  args: unknown[];
}
export type WorkerResponse = { id: number; value: unknown } | { id: number; error: string };
/** What the worker tells the window unasked: changes inside the folder. */
export interface WorkerEvent {
  changes: FolderChanges;
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

  /** `post` sends a request; pass each response to `receive`. */
  constructor(private readonly post: (request: WorkerRequest) => void) {}

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
      resolve: (value) => response.resolve(value as Awaited<ReturnType<API[Method]>>)
    });
    try {
      this.post({ args, id, method });
    } catch (error) {
      this.pending.delete(id);
      response.reject(error);
    }
    return response.promise;
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
