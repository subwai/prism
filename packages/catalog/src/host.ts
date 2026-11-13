import {
  type CatalogFiles,
  closeConnections,
  readerConnections,
  writerConnections,
} from '#connections';
import { CatalogReader, type CatalogReaderAPI, READER_METHODS, type ReaderEvent } from '#reader';
import { CatalogWriter, type CatalogWriterAPI, type WriterEvent } from '#writer';
import { serve, type WorkerRequest, type WorkerResponse } from '@prism/shared';

/** What the catalog answers its callers, whichever of its reader and writer answers each. */
export type CatalogAPI = Omit<CatalogReaderAPI, 'changed'> &
  Omit<CatalogWriterAPI, 'library' | 'useOrders'>;

/** What the catalog tells its callers unasked: a view has a new version. */
export type CatalogEvent = Extract<ReaderEvent, { view: unknown }>;

/** What a host of the catalog says unasked, which its client passes on or acts on. */
export type HostEvent = ReaderEvent | WriterEvent;

/**
 * What a thread hosts of the catalog of the library at `root`, kept in `files`: its writer, its
 * reader, which starts once the writer knows the library's number, or both, sharing their
 * connections, for files kept in memory, which only one connection reaches.
 */
export type HostRole = { files: CatalogFiles; root: string } & (
  | { role: 'writer' }
  | { role: 'reader'; library: number }
  | { role: 'both' }
);

/** A host of the catalog, as its thread runs it. */
export interface CatalogHost {
  serve: (request: WorkerRequest) => Promise<WorkerResponse>;
  close: () => void;
}

/**
 * The writer and reader on one thread and one set of connections. Each hears of the other
 * directly, so the reader hears of a write before anything that follows it, as on one thread
 * they arrive in order.
 */
function hostBoth({ files, root }: HostRole, emit: (event: HostEvent) => void): CatalogHost {
  const connections = writerConnections(files);
  // The reader needs the library's number, which the writer registers, so it comes second.
  const after: { reader?: CatalogReader } = {};
  const writer = new CatalogWriter(connections, root, () => after.reader?.changed());
  const reader = new CatalogReader(connections, root, writer.library(), (event) => {
    if ('orders' in event) {
      writer.useOrders(event.orders);
    } else {
      emit(event);
    }
  });
  after.reader = reader;
  return {
    close() {
      reader.close();
      closeConnections(connections);
    },
    serve: (request) => serve(READER_METHODS.has(request.method) ? reader : writer, request),
  };
}

/** Opens what `role` says a thread hosts of the catalog; `emit` tells its client unasked. */
export function openHost(role: HostRole, emit: (event: HostEvent) => void): CatalogHost {
  if (role.role === 'both') {
    return hostBoth(role, emit);
  }
  if (role.role === 'writer') {
    const connections = writerConnections(role.files);
    const writer = new CatalogWriter(connections, role.root, emit);
    return {
      close: () => closeConnections(connections),
      serve: (request) => serve(writer, request),
    };
  }
  const connections = readerConnections(role.files);
  const reader = new CatalogReader(connections, role.root, role.library, emit);
  return {
    close() {
      reader.close();
      closeConnections(connections);
    },
    serve: (request) => serve(reader, request),
  };
}
