import { catalogDatabase, transaction } from '#data/database';
import { forgetAllDetails } from '#data/details';
import { clearCache } from '#data/exif-cache';
import { migrateIndex, NewerIndexError } from '#index-migrations';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// Several folders' workers share the file; one waits this long for another's write.
const BUSY_TIMEOUT_MS = 5000;

/**
 * The index file's name. Its tables change through migrations, so it keeps this name; files of
 * the versions before them, such as `photo-index-v5.db`, are removed in time as stale caches.
 */
export const INDEX_FILE_NAME = 'photo-index.db';

/** Opens the index at `file`, bringing its tables up to date. */
export function connectIndex(file: string): DatabaseSync {
  const database = new DatabaseSync(file, { timeout: BUSY_TIMEOUT_MS });
  try {
    database.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
    migrateIndex(database);
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}

function opens(file: string) {
  connectIndex(file).close();
  return file;
}

/**
 * The index file a library keeps its catalog in: `file`, started afresh if it cannot be read,
 * or `:memory:` for this session only if it cannot be written either. It is a cache, never the
 * source of truth, so losing it loses nothing but time.
 */
export function prepareIndex(file: string): string {
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    return opens(file);
  } catch (error) {
    // A newer build's index is that build's to keep.
    if (!(error instanceof NewerIndexError)) {
      for (const suffix of ['', '-wal', '-shm']) {
        rmSync(`${file}${suffix}`, { force: true });
      }
    }
  }
  try {
    return opens(file);
  } catch (error) {
    process.emitWarning(`The photo index is kept in memory: ${String(error)}`);
    return ':memory:';
  }
}

/**
 * Forgets everything read from inside photos, so every photo is read again. The catalog keeps
 * its entries, so views still show them meanwhile.
 */
export function forgetDetails(file: string): void {
  const database = connectIndex(file);
  try {
    const db = catalogDatabase(database);
    transaction(db, () => {
      clearCache(db);
      forgetAllDetails(db);
    });
  } finally {
    database.close();
  }
}
