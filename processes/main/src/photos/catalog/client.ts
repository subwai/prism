import { type CatalogAPI, type CatalogEvent, createCatalogHost } from '#photos/catalog/host';
import type { CatalogWrite } from '#photos/catalog/writes';
import { WorkerClient, type WorkerRequest, type WorkerResponse } from '@prism/shared';
import path from 'node:path';
import { Worker } from 'node:worker_threads';

// Writes wait this long, or for this many entries, to go to the catalog together: each
// transaction syncs the disk, so larger ones write a library several times as fast.
const FLUSH_MS = 250,
  FLUSH_ENTRIES = 4096,
  CLOSED = 'The catalog is closed.';

/** How many entries a write holds, to tell when enough are waiting. */
function sizeOf(write: CatalogWrite) {
  if ('listed' in write) {
    return write.listed.length;
  }
  if ('removed' in write) {
    return write.removed.length;
  }
  return 'details' in write ? write.details.length : 1;
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
        for (const listener of this.listeners) {
          listener(data.event);
        }
      } else {
        this.client.receive(data);
      }
    });
    this.client = new WorkerClient<CatalogAPI>((request) => this.channel.post(request));
  }

  /** The catalog of the library at `root`, kept in the index `file`, on a thread of its own. */
  static threaded(file: string, root: string): Catalog {
    return new Catalog((receive) => {
      const worker = new Worker(path.join(import.meta.dirname, 'catalog-thread.js'), {
        workerData: { file, root },
      });
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
      const host = createCatalogHost(file, root, (event) => receive({ event }));
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
            try {
              const method = host[message.method as keyof CatalogAPI];
              receive({ id: message.id, value: Reflect.apply(method, host, message.args) });
            } catch (error) {
              receive({ error: String(error), id: message.id });
            }
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
      // What was not written is read again next time the folder is.
      if (!this.closed) {
        process.emitWarning(`Could not write the catalog: ${String(error)}`);
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
