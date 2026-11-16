import { catalogDatabase, transaction } from '#data/database';
import { forgetAllDetails } from '#data/details';
import { dropRemovedDetails } from '#data/removed-details';
import { migrateIndex } from '#index-migrations';
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

/** Opens the index at `file`, bringing its tables up to date; see `migrateIndex`. */
export function connectIndex(file: string, upgrading?: () => void): DatabaseSync {
  const database = new DatabaseSync(file, { timeout: BUSY_TIMEOUT_MS });
  try {
    database.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
    migrateIndex(database, upgrading);
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}

/**
 * Opens the index at `file` to read only, beside the connection that writes it. The index is in
 * WAL mode, which `connectIndex` set and the file keeps, so this connection reads the last
 * write committed while another write is under way, rather than waiting for it.
 */
export function readIndex(file: string): DatabaseSync {
  const database = new DatabaseSync(file, { timeout: BUSY_TIMEOUT_MS });
  try {
    database.exec('PRAGMA query_only = ON; PRAGMA cache_size = -65536;');
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}

function opens(file: string, upgrading?: () => void) {
  connectIndex(file, upgrading).close();
  return file;
}

/** SQLite's result codes for a file that is not a database, or one that is damaged. */
const DAMAGED = new Set([11, 26]);

/** Whether `error` means the file is damaged, rather than busy, a newer build's or unwritable. */
function isDamaged(error: unknown) {
  // node:sqlite gives the extended code, whose low byte is the primary one.
  const code = (error as { errcode?: unknown }).errcode;
  return typeof code === 'number' && DAMAGED.has(code % 256);
}

function inMemory(error: unknown) {
  process.emitWarning(`The photo index is kept in memory: ${String(error)}`);
  return ':memory:';
}

/**
 * The index file a library keeps its catalog in: `file`, started afresh if it is damaged, or
 * `:memory:` for this session only if it cannot be opened otherwise. It is a cache, never the
 * source of truth, but one of a library on a network share takes hours to make again, so only a
 * damaged file is ever removed: a busy one, a newer build's or one that cannot be written is
 * kept for the next launch. `upgrading` hears first when its tables have migrations to apply.
 */
export function prepareIndex(file: string, upgrading?: () => void): string {
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    return opens(file, upgrading);
  } catch (error) {
    if (!isDamaged(error)) {
      return inMemory(error);
    }
    for (const suffix of ['', '-wal', '-shm']) {
      rmSync(`${file}${suffix}`, { force: true });
    }
  }
  try {
    return opens(file);
  } catch (error) {
    return inMemory(error);
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
      dropRemovedDetails(db);
      forgetAllDetails(db);
    });
  } finally {
    database.close();
  }
}
