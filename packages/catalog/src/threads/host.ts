import {
  type CatalogFiles,
  closeConnections,
  readerConnections,
  writerConnections,
} from '#files/connections';
import type { Channel, Connect } from '#threads/channels';
import {
  CatalogReader,
  type CatalogReaderAPI,
  READER_METHODS,
  type ReaderEvent,
} from '#threads/reader';
import { CatalogWriter, type CatalogWriterAPI, type WriterEvent } from '#threads/writer';
import { viewSources } from '#views/catalog-views';
import { ViewOrders, type ViewOrdersAPI } from '#views/view-orders';
import type { TreeChanges } from '#writes/write-catalog';
import { serve, WorkerClient, type WorkerRequest, type WorkerResponse } from '@prism/shared';

/** What the catalog answers its callers, whichever of its reader and writer answers each. */
export type CatalogAPI = Omit<CatalogReaderAPI, 'changed'> &
  Omit<CatalogWriterAPI, 'library' | 'useOrders'>;

/** What the catalog tells its callers unasked: a view has a new version. */
export type CatalogEvent = Extract<ReaderEvent, { view: unknown }>;

/**
 * What a host of the catalog says unasked, which its client passes on or acts on: with the
 * reader and writer on one thread, what of the tree a write changed.
 */
export type HostEvent = ReaderEvent | WriterEvent | TreeChanges;

/**
 * What a thread hosts of the catalog of the library at `root`, kept in `files`: its writer, its
 * reader, which starts once the writer knows the library's number, the maker of the reader's
 * views' orders, which the reader starts, or all of them, sharing their connections, for files
 * kept in memory, which only one connection reaches.
 */
export type HostRole = { files: CatalogFiles; root: string } & (
  | { role: 'writer' }
  | { role: 'reader'; library: number }
  | { role: 'views'; library: number }
  | { role: 'all' }
);

/** A host of the catalog, as its thread runs it. */
export interface CatalogHost {
  serve: (request: WorkerRequest) => Promise<WorkerResponse>;
  close: () => Promise<void>;
}

/**
 * The writer, reader and views' orders on one thread and one set of connections. Each hears of
 * the other directly, so the reader hears of a write before anything that follows it, as on one
 * thread they arrive in order.
 */
function hostAll({ files, root }: HostRole, emit: (event: HostEvent) => void): CatalogHost {
  const connections = writerConnections(files);
  // The reader needs the library's number, which the writer registers, so it comes second.
  const after: { reader?: CatalogReader } = {};
  const writer = new CatalogWriter(connections, root, (event) => {
    if ('activity' in event || 'details' in event) {
      emit(event);
      return;
    }
    after.reader?.changed(event.onlyDetails, event.unread);
    if (event.folders.length > 0 || event.tiles.length > 0) {
      emit({ folders: event.folders, tiles: event.tiles });
    }
  });
  const library = writer.library();
  const orders = new ViewOrders(viewSources(connections, root, library));
  const reader = new CatalogReader(
    connections,
    root,
    library,
    (event) => {
      if ('orders' in event) {
        writer.useOrders(event.orders);
      } else {
        emit(event);
      }
    },
    {
      facets: (spec) => Promise.resolve(orders.facets(spec)),
      make: (spec, generation) => Promise.resolve(orders.make(spec, generation)),
      unread: (spec) => Promise.resolve(orders.unread(spec)),
    },
  );
  after.reader = reader;
  return {
    close() {
      writer.close();
      reader.close();
      closeConnections(connections);
      return Promise.resolve();
    },
    serve: (request) => serve(READER_METHODS.has(request.method) ? reader : writer, request),
  };
}

/**
 * The reader, which has the views' orders made on a host of their own, which `connect` starts,
 * so its thread answers the window while a large view is made.
 */
function hostReader(
  { files, library, root }: Extract<HostRole, { role: 'reader' }>,
  emit: (event: HostEvent) => void,
  connect: Connect,
): CatalogHost {
  const connections = readerConnections(files);
  // The client posts on the channel, which answers through the client.
  const opened: { views?: Channel } = {};
  const orders = new WorkerClient<ViewOrdersAPI>((request) => opened.views?.post(request));
  const views = connect({ files, library, role: 'views', root }, (message) =>
    orders.receive(message as WorkerResponse),
  );
  opened.views = views;
  const reader = new CatalogReader(connections, root, library, emit, {
    facets: (spec) => orders.call('facets', spec),
    make: (spec, generation) => orders.call('make', spec, generation),
    unread: (spec) => orders.call('unread', spec),
  });
  return {
    async close() {
      reader.close();
      orders.close('The catalog is closed.');
      // It finishes the order it is making before it closes its connections.
      await views.close();
      closeConnections(connections);
    },
    serve: (request) => serve(reader, request),
  };
}

/**
 * Opens what `role` says a thread hosts of the catalog; `emit` tells its client unasked, and
 * `connect` starts the hosts it starts in turn.
 */
export function openHost(
  role: HostRole,
  emit: (event: HostEvent) => void,
  connect: Connect,
): CatalogHost {
  if (role.role === 'all') {
    return hostAll(role, emit);
  }
  if (role.role === 'reader') {
    return hostReader(role, emit, connect);
  }
  if (role.role === 'writer') {
    const connections = writerConnections(role.files);
    const writer = new CatalogWriter(connections, role.root, emit);
    return {
      close() {
        writer.close();
        closeConnections(connections);
        return Promise.resolve();
      },
      serve: (request) => serve(writer, request),
    };
  }
  const connections = readerConnections(role.files);
  const orders = new ViewOrders(viewSources(connections, role.root, role.library));
  return {
    close() {
      closeConnections(connections);
      return Promise.resolve();
    },
    serve: (request) => serve(orders, request),
  };
}
