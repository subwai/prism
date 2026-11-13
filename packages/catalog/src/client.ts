import { type Channel, type Connect, inProcessHost, openedLater, threadHost } from '#channels';
import { type CatalogFiles, inMemory } from '#connections';
import type { CatalogAPI, CatalogEvent, HostEvent } from '#host';
import { type CatalogReaderAPI, READER_METHODS } from '#reader';
import type { CatalogWriterAPI } from '#writer';
import type { CatalogWrite } from '#writes';
import { debug, WorkerClient, type WorkerResponse } from '@prism/shared';

// Writes wait this long, or for this many entries, to go to the catalog together: each
// transaction syncs the disk, so larger ones write a library several times as fast.
const FLUSH_MS = 250;
const FLUSH_ENTRIES = 4096;
const CLOSED = 'The catalog is closed.';
const calls = debug('catalog:calls');
const events = debug('catalog:events');

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

/** Everything a host may answer, as one host answers both a reader's calls and a writer's. */
type HostAPI = CatalogReaderAPI & CatalogWriterAPI;

/**
 * The folder's catalog, as the worker's own thread uses it. Its writer applies writes, which
 * queue up and go together, and answers the indexer and enricher, after the writes sent before
 * each call. Its reader, with a connection of its own, answers the window's reads, which never
 * wait for a write or for that background work, and keeps the open views. A read sees the
 * writes whose callers have heard back, as the writer tells the reader of each before answering
 * it; to read what was only queued, wait for `committed` first. Calls answer asynchronously,
 * from threads of their own in the app, or from this one in tests. A catalog kept in memory has
 * one connection, which its reader and writer share, on one thread.
 */
export class Catalog {
  private readonly writer: WorkerClient<HostAPI>;
  private readonly reader: WorkerClient<HostAPI>;
  private readonly channels: Channel[];
  private readonly listeners = new Set<(event: CatalogEvent) => void>();
  private readonly failureListeners = new Set<(writes: CatalogWrite[]) => void>();
  private queued: CatalogWrite[] = [];
  private queuedSize = 0;
  private timer: NodeJS.Timeout | undefined;
  private closed = false;
  /** How many writes have been queued, each numbered in turn, which `committed` waits for. */
  private sequence = 0;
  /** The number of the last write sent to the writer. */
  private sent = 0;
  /** The number of the last write the writer answered, whose caller and the reader can see it. */
  private answered = 0;
  private readonly waiting = new Set<{ upTo: number; resolve: () => void }>();

  /** Opens the catalog of the library at `root`, kept in `files`, whose hosts `connect` starts. */
  constructor(files: CatalogFiles, root: string, connect: Connect) {
    if (inMemory(files)) {
      const channel = connect({ files, role: 'both', root }, (message) =>
        this.receive(this.writer, message),
      );
      this.writer = new WorkerClient<HostAPI>((request) => channel.post(request), calls);
      this.reader = this.writer;
      this.channels = [channel];
      return;
    }
    const writer = connect({ files, role: 'writer', root }, (message) =>
      this.receive(this.writer, message),
    );
    this.writer = new WorkerClient<HostAPI>((request) => writer.post(request), calls);
    // The reader starts once the writer has registered the library and knows its number.
    const reader = openedLater(
      this.writer.call('library').then(
        (library) =>
          this.closed
            ? null
            : connect({ files, library, role: 'reader', root }, (message) =>
                this.receive(this.reader, message),
              ),
        (error: unknown) => {
          this.reader.close(String(error));
          return null;
        },
      ),
    );
    this.reader = new WorkerClient<HostAPI>((request) => reader.post(request), calls);
    this.channels = [writer, reader];
  }

  /** Opens catalogs whose hosts run on threads of their own, which run the script `entry`. */
  static threaded(entry: string): (files: CatalogFiles, root: string) => Catalog {
    return (files, root) => new Catalog(files, root, threadHost(entry));
  }

  /** The same catalog on this thread, answering each call after the current task. */
  static inProcess(files: CatalogFiles, root: string): Catalog {
    return new Catalog(files, root, inProcessHost);
  }

  /** Passes on what a host says unasked, and answers to `client`'s calls. */
  private receive(client: WorkerClient<HostAPI>, message: unknown) {
    const data = message as WorkerResponse | { event: HostEvent };
    if (!('event' in data)) {
      client.receive(data);
      return;
    }
    const { event } = data;
    if ('changed' in event) {
      // The writer tells of a write before answering it, so the reader hears of it before
      // anything its caller reads next.
      this.reader.call('changed').catch(() => null);
    } else if ('orders' in event) {
      this.writer.call('useOrders', event.orders).catch(() => null);
    } else {
      events('%o', event);
      for (const listener of this.listeners) {
        listener(event);
      }
    }
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

  /** Queues a write, which goes with others soon; returns its number, for `committed`. */
  write(write: CatalogWrite): number {
    if (this.closed) {
      return this.sequence;
    }
    this.queued.push(write);
    this.queuedSize += sizeOf(write);
    this.sequence += 1;
    if (this.queuedSize >= FLUSH_ENTRIES) {
      this.flush();
    } else {
      this.timer ??= setTimeout(() => this.flush(), FLUSH_MS);
    }
    return this.sequence;
  }

  /** Sends the queued writes now. */
  flush(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.queued.length === 0 || this.closed) {
      return;
    }
    const writes = this.queued;
    const last = this.sequence;
    this.queued = [];
    this.queuedSize = 0;
    this.sent = last;
    this.writer
      .call('write', writes)
      .catch((error: unknown) => {
        if (this.closed) {
          return;
        }
        process.emitWarning(`Could not write the catalog: ${String(error)}`);
        for (const listener of this.failureListeners) {
          listener(writes);
        }
      })
      .then(() => this.answer(last));
  }

  /** Notes that the writer answered the writes up to `last`, settling what waits for them. */
  private answer(last: number) {
    this.answered = Math.max(this.answered, last);
    for (const waiter of this.waiting) {
      if (waiter.upTo <= this.answered) {
        this.waiting.delete(waiter);
        waiter.resolve();
      }
    }
  }

  /**
   * Settles once the write numbered `upTo`, and every one before it, is in the catalog, or could
   * not be written, so a read sent then sees it: by default, every write queued so far.
   */
  committed(upTo = this.sequence): Promise<void> {
    if (upTo <= this.answered || this.closed) {
      return Promise.resolve();
    }
    if (upTo > this.sent) {
      this.flush();
    }
    return new Promise((resolve) => {
      this.waiting.add({ resolve, upTo });
    });
  }

  /**
   * Calls the catalog. A read for the window goes to the reader at once, and sees the writes
   * whose callers have heard back. Anything else goes to the writer with the writes queued
   * before it, and sees them.
   */
  call<Method extends keyof CatalogAPI & string>(
    method: Method,
    ...args: Parameters<CatalogAPI[Method]>
  ): Promise<ReturnType<CatalogAPI[Method]>> {
    if (READER_METHODS.has(method)) {
      return this.reader.call(method, ...args) as Promise<ReturnType<CatalogAPI[Method]>>;
    }
    this.flush();
    return this.writer.call(method, ...args) as Promise<ReturnType<CatalogAPI[Method]>>;
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    await this.committed();
    this.closed = true;
    this.answer(this.sequence);
    this.writer.close(CLOSED);
    this.reader.close(CLOSED);
    await Promise.all(this.channels.map((channel) => channel.close()));
  }
}
