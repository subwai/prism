import { connectIndex, readIndex } from '#photo-index';
import { connectRatings, readRatings } from '#ratings-file';
import type { DatabaseSync } from 'node:sqlite';

/** The files a catalog keeps: the photo index, a cache, and the ratings, which are not. */
export interface CatalogFiles {
  index: string;
  ratings: string;
}

/** A connection to each of a catalog's files. */
export interface CatalogConnections {
  index: DatabaseSync;
  ratings: DatabaseSync;
}

/**
 * Whether either of `files` is kept in memory for the session, which only the connection that
 * made it reaches, so the catalog's reader and writer share their connections and a thread.
 */
export function inMemory(files: CatalogFiles): boolean {
  return files.index === ':memory:' || files.ratings === ':memory:';
}

/** Opens the index and then the ratings file, closing the index if the ratings file fails. */
function openBoth(
  files: CatalogFiles,
  openIndex: (file: string) => DatabaseSync,
  openRatings: (file: string) => DatabaseSync,
): CatalogConnections {
  const index = openIndex(files.index);
  try {
    return { index, ratings: openRatings(files.ratings) };
  } catch (error) {
    index.close();
    throw error;
  }
}

/** The writer's connections, which bring the files' tables up to date as they open. */
export function writerConnections(files: CatalogFiles): CatalogConnections {
  const connections = openBoth(files, connectIndex, connectRatings);
  // Reading a library writes many rows; checkpointing less often spares most of the syncs.
  // `connectIndex` sets how long it waits for another worker's write.
  connections.index.exec('PRAGMA wal_autocheckpoint = 10000; PRAGMA cache_size = -65536;');
  return connections;
}

/** The reader's connections, which only read, and never wait for the writer's. */
export function readerConnections(files: CatalogFiles): CatalogConnections {
  return openBoth(files, readIndex, readRatings);
}

export function closeConnections({ index, ratings }: CatalogConnections): void {
  index.close();
  ratings.close();
}
