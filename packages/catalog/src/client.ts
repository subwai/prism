import { type CatalogAPI, type CatalogEvent, CatalogHost } from '#host';
import type { CatalogWrite } from '#writes';
import { debug, serve, WorkerClient, type WorkerRequest, type WorkerResponse } from '@prism/shared';
import { Worker } from 'node:worker_threads';

// Writes wait this long, or for this many entries, to go to the catalog together: each
// transaction syncs the disk, so larger ones write a library several times as fast.
const FLUSH_MS = 250,
  FLUSH_ENTRIES = 4096,
  CLOSED = 'The catalog is closed.',
  calls = debug('catalog:calls'),
  events = debug('catalog:events');

/** How many entries a write holds, to tell when enough are waiting. */
function sizeOf(write: CatalogWrite) {
  if ('listed' in write) {
    return write.listed.length;
  }
  if ('removed' in write) {
    return write.removed.length;
  }
  if ('details' in write) {
    return write.details.length;
  }
  return 'recalled' in write ? write.recalled.length : 1;
}

interface Channel {
  post: (message: WorkerRequest | { close: true }) => void;
  close: () => Promise<void>;
}

/**
 * The folder's catalog, as the worker's own thread uses it: writes queue up and go together,
 * and every call sends what is queued first, so it sees them. Calls answer asynchronously,
 * from a thread of its own in the app, or from this one in tests, which run the sources as
 * they are rather than bundled.
 */
export class Catalog {
  private readonly client: WorkerClient<CatalogAPI>;
  private readonly listeners = new Set<(event: CatalogEvent) => void>();
  private readonly failureListeners = new Set<(writes: CatalogWrite[]) => void>();
  private queued: CatalogWrite[] = [];
  private queuedSize = 0;
  private timer: NodeJS.Timeout | undefined;
  private closed = false;
  /** The last write sent, which closing waits for. */
  private written: Promise<unknown> = Promise.resolve();
  private readonly channel: Channel;

  private constructor(connect: (receive: (message: unknown) => void) => Channel) {
    this.channel = connect((message) => {
      const data = message as WorkerResponse | { event: CatalogEvent };
      if ('event' in data) {
        events('%o', data.event);
        for (const listener of this.listeners) {
          listener(data.event);
        }
      } else {
        this.client.receive(data);
      }
    });
    this.client = new WorkerClient<CatalogAPI>((request) => this.channel.post(request), calls);
  }

  /**
   * Opens the catalog of the library at `root`, kept in the index `file`, on a thread of its
   * own, which runs the script `entry` that hands its requests to a `CatalogHost`.
   */
  static threaded(entry: string): (file: string, root: string) => Catalog {
    return (file, root) =>
      new Catalog((receive) => {
        const worker = new Worker(entry, { workerData: { file, root } });
        worker.on('message', receive);
        return {
          close: async () => {
            // eslint-disable-next-line unicorn/require-post-message-target-origin -- A worker thread has no targetOrigin.
            worker.postMessage({ close: true });
            await new Promise((resolve) => {
              worker.once('exit', resolve);
            });
          },
          // eslint-disable-next-line unicorn/require-post-message-target-origin -- A worker thread has no targetOrigin.
          post: (message) => worker.postMessage(message),
        };
      });
  }

  /** The same catalog on this thread, answering each call after the current task. */
  static inProcess(file: string, root: string): Catalog {
    return new Catalog((receive) => {
      const host = new CatalogHost(file, root, (event) => receive({ event }));
      return {
        close: () => {
          host.close();
          return Promise.resolve();
        },
        post(message) {
          if ('close' in message) {
            return;
          }
          queueMicrotask(() => {
            serve(host, message).then(receive);
          });
        },
      };
    });
  }

  /** Hears of views made again as the catalog changed. */
  onEvent(listener: (event: CatalogEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Hears of writes the catalog could not make, whose folders must be read again. */
  onWriteFailed(listener: (writes: CatalogWrite[]) => void): () => void {
    this.failureListeners.add(listener);
    return () => this.failureListeners.delete(listener);
  }

  /** Queues a write; it goes with the next call, or soon. */
  write(write: CatalogWrite): void {
    if (this.closed) {
      return;
    }
    this.queued.push(write);
    this.queuedSize += sizeOf(write);
    if (this.queuedSize >= FLUSH_ENTRIES) {
      this.flush();
    } else {
      this.timer ??= setTimeout(() => this.flush(), FLUSH_MS);
    }
  }

  /** Sends the queued writes now. */
  flush(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.queued.length === 0 || this.closed) {
      return;
    }
    const writes = this.queued;
    this.queued = [];
    this.queuedSize = 0;
    this.written = this.client.call('write', writes).catch((error: unknown) => {
      if (this.closed) {
        return;
      }
      process.emitWarning(`Could not write the catalog: ${String(error)}`);
      for (const listener of this.failureListeners) {
        listener(writes);
      }
    });
  }

  call<Method extends keyof CatalogAPI & string>(
    method: Method,
    ...args: Parameters<CatalogAPI[Method]>
  ): Promise<ReturnType<CatalogAPI[Method]>> {
    this.flush();
    return this.client.call(method, ...args) as Promise<ReturnType<CatalogAPI[Method]>>;
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.flush();
    await this.written;
    this.closed = true;
    this.client.close(CLOSED);
    await this.channel.close();
  }
}
