import { type CatalogFiles, inMemory } from '#database/connections';
import { type CatalogWrite, sizeOf } from '#services/writes/write-catalog';
import type { TreeChanges } from '#services/writes/write-result';
import type { CatalogActivity } from '#threads/busy-change';
import { CatalogActivityState } from '#threads/catalog-activity-state';
import {
  type Channel,
  type Connect,
  inProcessHost,
  openedLater,
  threadHost,
} from '#threads/channels';
import type { CatalogAPI, CatalogEvent, HostEvent } from '#threads/host';
import { type CatalogReaderAPI, READER_METHODS } from '#threads/reader';
import { RisingCount } from '#threads/rising-count';
import type { CatalogWriterAPI } from '#threads/writer-api';
import { debug, Listeners, WorkerClient, type WorkerResponse } from '@prism/shared';

// Writes wait this long, or for this many entries, to go to the catalog together: each
// transaction syncs the disk, so larger ones write a library several times as fast.
const FLUSH_MS = 250;
const FLUSH_ENTRIES = 4096;
const CLOSED = 'The catalog is closed.';
const calls = debug('catalog:calls');
const events = debug('catalog:events');

/** Everything a host may answer, as one host answers both a reader's calls and a writer's. */
type HostAPI = CatalogReaderAPI & CatalogWriterAPI;

/**
 * The library's catalog, used from the worker's own thread. Writes queue up and go to the writer
 * together. The writer also answers the indexer's and details reader's reads, after the writes sent
 * before them. The reader has a connection of its own. It answers the window's reads, so they
 * never wait for a write, and it keeps the open views. A read sees every write that has already
 * been answered; to read a write that is only queued, wait for `committed` first. A catalog kept
 * in memory has one connection, which its reader and writer share on one thread.
 */
export class Catalog {
  private readonly writer: WorkerClient<HostAPI>;
  private readonly reader: WorkerClient<HostAPI>;
  private readonly channels: Channel[];
  private readonly viewListeners = new Listeners<CatalogEvent>();
  private readonly folderListeners = new Listeners<TreeChanges>();
  private readonly failureListeners = new Listeners<CatalogWrite[]>();
  private readonly forgottenListeners = new Listeners();
  private queued: CatalogWrite[] = [];
  private queuedSize = 0;
  /** What the catalog is busy with: writes not yet answered, and what the writer last told. */
  private readonly busy = new CatalogActivityState();
  private timer: NodeJS.Timeout | undefined;
  private closed = false;
  /** How many writes have been queued, each numbered in turn, which `committed` waits for. */
  private sequence = 0;
  /** The number of the last write sent to the writer. */
  private sent = 0;
  /** The number of the last write the writer answered, whose caller and the reader can see it. */
  private readonly answered = new RisingCount();

  /** Opens the catalog of the library at `root`, kept in `files`, whose hosts `connect` starts. */
  constructor(files: CatalogFiles, root: string, connect: Connect) {
    if (inMemory(files)) {
      const channel = connect({ files, role: 'all', root }, (message) =>
        this.receive(this.writer, message),
      );
      this.writer = new WorkerClient<HostAPI>((request) => channel.post(request), calls);
      this.reader = this.writer;
      this.channels = [channel];
      this.writer.call('countDetails').catch(() => null);
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
    // After it answers `library`, so the reader answers the window while it counts.
    this.writer.call('countDetails').catch(() => null);
  }

  /** Opens catalogs whose hosts run on threads of their own, which run the script `entry`. */
  static threaded(entry: string): (files: CatalogFiles, root: string) => Catalog {
    return (files, root) => new Catalog(files, root, threadHost(entry));
  }

  /** The same catalog on this thread, answering each call after the current task. */
  static inProcess(files: CatalogFiles, root: string): Catalog {
    return new Catalog(files, root, inProcessHost);
  }

  /** Sends a host's event to `handleEvent`, and an answer to a call back to `client`. */
  private receive(client: WorkerClient<HostAPI>, message: unknown) {
    const data = message as WorkerResponse | { kind: 'event'; event: HostEvent };
    if (data.kind === 'event') {
      this.handleEvent(data.event);
    } else {
      client.receive(data);
    }
  }

  /** Acts on an event that a host sends without being asked. */
  private handleEvent(event: HostEvent) {
    switch (event.kind) {
      case 'busy': {
        this.busy.update({ [event.activity]: event.busy });
        break;
      }
      case 'details': {
        this.busy.update({ details: event.details });
        break;
      }
      case 'forgetting': {
        this.busy.update({ forgettingDetails: event.progress });
        break;
      }
      case 'detailsForgotten': {
        this.busy.update({ forgettingDetails: null });
        this.forgottenListeners.tell();
        break;
      }
      case 'changed': {
        // The writer reports a write before it answers it. So the reader learns of the write
        // before its caller can read anything next.
        this.reader.call('changed', event.onlyDetails, event.unread).catch(() => null);
        this.tellFolders(event);
        break;
      }
      case 'orders': {
        this.writer.call('useOrders', event.orders).catch(() => null);
        break;
      }
      case 'treeChanged': {
        this.tellFolders(event);
        break;
      }
      case 'view': {
        events('%o', event);
        this.viewListeners.tell(event);
        break;
      }
      // No default
    }
  }

  private tellFolders({ folders, tiles }: TreeChanges) {
    if (folders.length === 0 && tiles.length === 0) {
      return;
    }
    events('subfolders changed in %o, tiles of %o', folders, tiles);
    this.folderListeners.tell({ folders, tiles });
  }

  /** Hears of views made again as the catalog changed. */
  onEvent(listener: (event: CatalogEvent) => void): () => void {
    return this.viewListeners.add(listener);
  }

  /**
   * Hears that a forget of every photo's details is done. It reached every library's photos,
   * which other libraries' catalogs can't tell.
   */
  onDetailsForgotten(listener: () => void): () => void {
    return this.forgottenListeners.add(listener);
  }

  /** Hears what each committed write changed in the sidebar's tree; see `TreeChanges`. */
  onFoldersChanged(listener: (changes: TreeChanges) => void): () => void {
    return this.folderListeners.add(listener);
  }

  /** What the catalog is busy with now; see `onActivity`. */
  activity(): CatalogActivity {
    return this.busy.current();
  }

  /** Hears as what the catalog is busy with changes. */
  onActivity(listener: () => void): () => void {
    return this.busy.onChange(listener);
  }

  /** Hears of writes the catalog could not make, whose folders must be read again. */
  onWriteFailed(listener: (writes: CatalogWrite[]) => void): () => void {
    return this.failureListeners.add(listener);
  }

  /** Queues a write, which goes with others soon; returns its number, for `committed`. */
  write(write: CatalogWrite): number {
    if (this.closed) {
      return this.sequence;
    }
    this.queued.push(write);
    this.queuedSize += sizeOf(write);
    this.busy.addUnsaved(sizeOf(write));
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
    const size = this.queuedSize;
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
        this.failureListeners.tell(writes);
      })
      .then(() => this.noteAnswered(last, size));
  }

  /** Notes that the writer answered the writes up to `last`, of `entries`, settling what waits. */
  private noteAnswered(last: number, entries = 0) {
    this.busy.addUnsaved(-entries);
    this.answered.raise(last);
  }

  /**
   * Settles once the write numbered `upTo`, and every one before it, is in the catalog, or could
   * not be written, so a read sent then sees it: by default, every write queued so far.
   */
  committed(upTo = this.sequence): Promise<void> {
    if (upTo <= this.answered.value || this.closed) {
      return Promise.resolve();
    }
    if (upTo > this.sent) {
      this.flush();
    }
    return this.answered.reached(upTo);
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

  /**
   * Every folder of the library, as the text of a `SerializedTreeListing`. The reader returns the stored
   * listing at once. Without one, the writer builds it: that takes seconds from a cold disk, and
   * the reader answers the window's reads one at a time, so they would wait behind it.
   */
  async listWholeTree(): Promise<string> {
    return (await this.call('storedTreeListing')) ?? this.call('listWholeTree');
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    await this.committed();
    this.closed = true;
    this.noteAnswered(this.sequence);
    this.writer.close(CLOSED);
    this.reader.close(CLOSED);
    await Promise.all(this.channels.map((channel) => channel.close()));
  }
}
