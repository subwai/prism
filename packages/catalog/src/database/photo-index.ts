import { migrateIndex } from '#database/migrate';
import { openDatabase } from '#database/open-database';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

/**
 * The index file's name. Its tables change through migrations, so it keeps this name; files of
 * the versions before them, such as `photo-index-v5.db`, are removed in time as stale caches.
 */
export const INDEX_FILE_NAME = 'photo-index.db';

/** Opens the index at `file`, bringing its tables up to date; see `migrateIndex`. */
export function connectIndex(file: string, upgrading?: () => void): DatabaseSync {
  return openDatabase(file, {
    kind: 'write',
    migrate: (database) => migrateIndex(database, upgrading),
  });
}

/**
 * Opens the index at `file` to read only, beside the connection that writes it, with a large
 * cache, as every read of the window goes through it; see `openDatabase`.
 */
export function readIndex(file: string): DatabaseSync {
  return openDatabase(file, { cache: 'large', kind: 'read' });
}

/** Opens `file` once, applying its migrations, and closes it; throws if it can't be opened. */
function checkOpens(file: string, upgrading?: () => void) {
  connectIndex(file, upgrading).close();
  return file;
}

/** SQLite's result codes for a file that is not a database, or one that is damaged. */
const DAMAGED_FILE_CODES = new Set([11, 26]);

/** Whether `error` means the file is damaged, rather than busy, a newer build's or unwritable. */
function isDamaged(error: unknown) {
  // node:sqlite gives the extended code, whose low byte is the primary one.
  const code = (error as { errcode?: unknown }).errcode;
  return typeof code === 'number' && DAMAGED_FILE_CODES.has(code % 256);
}

/** Warns that the catalog lives in memory this session, because its file could not be opened. */
function fallBackToMemory(error: unknown) {
  process.emitWarning(`The photo index is kept in memory: ${String(error)}`);
  return ':memory:';
}

/**
 * The index file a library keeps its catalog in: `file`, started afresh if it is damaged, or
 * `:memory:` for this session only if it cannot be opened otherwise. It is a cache, never the
 * source of truth, but one of a library on a network share takes hours to make again, so only a
 * damaged file is ever removed: a busy one, a newer build's or one that cannot be written is
 * kept for the next launch. `upgrading` is called first when its tables have migrations to apply.
 */
export function prepareIndex(file: string, upgrading?: () => void): string {
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    return checkOpens(file, upgrading);
  } catch (error) {
    if (!isDamaged(error)) {
      return fallBackToMemory(error);
    }
    for (const suffix of ['', '-wal', '-shm']) {
      rmSync(`${file}${suffix}`, { force: true });
    }
  }
  try {
    return checkOpens(file);
  } catch (error) {
    return fallBackToMemory(error);
  }
}
