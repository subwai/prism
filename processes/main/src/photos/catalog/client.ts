import { type CatalogAPI, type CatalogEvent, createCatalogHost } from '#photos/catalog/host';
import type { CatalogWrite } from '#photos/catalog/writes';
import { createWorkerClient, type WorkerRequest, type WorkerResponse } from '@prism/shared';
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
  if ('details' in write) {
    return write.details.length;
  }
  return 'recalled' in write ? write.recalled.length : 1;
}

interface Channel {
  post: (message: WorkerRequest | { close: true }) => void;
  close: () => Promise<void>;
}

type Connect = (receive: (message: unknown) => void) => Channel;

/**
 * The folder's catalog, as the worker's own thread uses it: writes queue up and go together,
 * and every call sends what is queued first, so it sees them. Calls answer asynchronously,
 * from a thread of its own in the app, or from this one in tests, which run the sources as
 * they are rather than bundled.
 */
export interface Catalog {
  /** Hears of views made again as the catalog changed. */
  onEvent: (listener: (event: CatalogEvent) => void) => () => void;
  /** Hears of writes the catalog could not make, whose folders must be read again. */
  onWriteFailed: (listener: (writes: CatalogWrite[]) => void) => () => void;
  /** Queues a write; it goes with the next call, or soon. */
  write: (write: CatalogWrite) => void;
  /** Sends the queued writes now. */
  flush: () => void;
  call: <Method extends keyof CatalogAPI & string>(
    method: Method,
    ...args: Parameters<CatalogAPI[Method]>
  ) => Promise<ReturnType<CatalogAPI[Method]>>;
  close: () => Promise<void>;
}

function listen<Listener>(listeners: Set<Listener>, listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function createCatalog(connect: Connect): Catalog {
  const eventListeners = new Set<(event: CatalogEvent) => void>();
  const failureListeners = new Set<(writes: CatalogWrite[]) => void>();
  let queued: CatalogWrite[] = [];
  let queuedSize = 0;
  let timer: NodeJS.Timeout | undefined;
  let closed = false;
  /** The last write sent, which closing waits for. */
  let written: Promise<unknown> = Promise.resolve();
  const channel = connect(receive);
  const client = createWorkerClient<CatalogAPI>((request) => channel.post(request));

  function receive(message: unknown) {
    const data = message as WorkerResponse | { event: CatalogEvent };
    if ('event' in data) {
      for (const listener of eventListeners) {
        listener(data.event);
      }
    } else {
      client.receive(data);
    }
  }

  function flush() {
    clearTimeout(timer);
    timer = undefined;
    if (queued.length === 0 || closed) {
      return;
    }
    const writes = queued;
    queued = [];
    queuedSize = 0;
    written = client.call('write', writes).catch((error: unknown) => {
      if (closed) {
        return;
      }
      process.emitWarning(`Could not write the catalog: ${String(error)}`);
      for (const listener of failureListeners) {
        listener(writes);
      }
    });
  }

  return {
    call(method, ...args) {
      flush();
      return client.call(method, ...args) as never;
    },
    async close() {
      if (closed) {
        return;
      }
      flush();
      await written;
      closed = true;
      client.close(CLOSED);
      await channel.close();
    },
    flush,
    onEvent: (listener) => listen(eventListeners, listener),
    onWriteFailed: (listener) => listen(failureListeners, listener),
    write(write) {
      if (closed) {
        return;
      }
      queued.push(write);
      queuedSize += sizeOf(write);
      if (queuedSize >= FLUSH_ENTRIES) {
        flush();
      } else {
        timer ??= setTimeout(flush, FLUSH_MS);
      }
    },
  };
}

/** The catalog of the library at `root`, kept in the index `file`, on a thread of its own. */
export function threadedCatalog(file: string, root: string): Catalog {
  return createCatalog((receive) => {
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
export function inProcessCatalog(file: string, root: string): Catalog {
  return createCatalog((receive) => {
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
