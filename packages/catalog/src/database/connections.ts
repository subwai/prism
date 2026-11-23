import { openIndexToRead, openIndexToWrite } from '#database/photo-index/open';
import { openRatingsToRead, openRatingsToWrite } from '#database/ratings/open';
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
  const connections = openBoth(files, openIndexToWrite, openRatingsToWrite);
  // Reading a library writes many rows. A checkpoint copies the write-ahead log back into the
  // database file and waits for the disk, so doing it less often spares most of those waits.
  // A PRAGMA statement changes one of SQLite's settings for the connection.
  connections.index.exec('PRAGMA wal_autocheckpoint = 10000; PRAGMA cache_size = -65536;');
  return connections;
}

/** The reader's connections, which only read, and never wait for the writer's. */
export function readerConnections(files: CatalogFiles): CatalogConnections {
  return openBoth(files, openIndexToRead, openRatingsToRead);
}

export function closeConnections({ index, ratings }: CatalogConnections): void {
  index.close();
  ratings.close();
}
