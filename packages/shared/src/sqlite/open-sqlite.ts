import { DatabaseSync } from 'node:sqlite';

/**
 * The settings a database that is written to starts with, as SQLite's `PRAGMA` statements,
 * which change how the connection works. WAL, SQLite's write-ahead log, puts each write in a
 * file beside the database first, so readers keep reading the last finished write rather than
 * waiting for the one under way. The file keeps that mode, so readers opened later read the same
 * way. `synchronous = NORMAL` waits for the disk less often, which WAL keeps safe.
 */
export const WRITER_SETTINGS = 'PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;';

/** How to open a database file; see `openSqlite`. */
interface SqliteOptions {
  /** How long a write waits for another connection's write to finish before it fails. */
  busyTimeoutMs: number;
  /** Gets the connection ready, such as with its settings and its tables brought up to date. */
  setUp: (database: DatabaseSync) => void;
}

/**
 * Opens the SQLite database at `file` and sets it up, closing it again if setting it up fails,
 * so a file that cannot be used is not left open.
 */
export function openSqlite(file: string, { busyTimeoutMs, setUp }: SqliteOptions): DatabaseSync {
  const database = new DatabaseSync(file, { timeout: busyTimeoutMs });
  try {
    setUp(database);
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}
