import { DatabaseSync } from 'node:sqlite';

// Each open library has its own photo worker, whose catalog writer opens these same files. One
// writer waits this long for another's write to finish.
const BUSY_TIMEOUT_MS = 5000;

/**
 * What a connection is for: writing the database, after bringing its tables up to date with
 * `migrate`, or only reading it. A reader of the photo index keeps a `large` cache in memory,
 * as the window's reads go through it.
 */
export type OpenMode =
  | { kind: 'write'; migrate: (database: DatabaseSync) => void }
  | { kind: 'read'; cache: 'standard' | 'large' };

/**
 * The settings a writer starts with, as SQLite's `PRAGMA` statements, which change how the
 * connection works. WAL, SQLite's write-ahead log, puts each write in a file beside the database
 * first, so readers keep reading the last finished write rather than waiting for the one under
 * way. The file keeps that mode, so readers opened later read the same way. `synchronous =
 * NORMAL` waits for the disk less often, which WAL keeps safe.
 */
const WRITER_SETTINGS = 'PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;';

/** The settings a reader starts with: it can only read, and a `large` cache is 64 MB. */
const READER_SETTINGS = {
  large: 'PRAGMA query_only = ON; PRAGMA cache_size = -65536;',
  standard: 'PRAGMA query_only = ON;',
};

/** Opens the database at `file` for `mode`, closing it again if setting it up fails. */
export function openDatabase(file: string, mode: OpenMode): DatabaseSync {
  const database = new DatabaseSync(file, { timeout: BUSY_TIMEOUT_MS });
  try {
    setUp(database, mode);
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}

function setUp(database: DatabaseSync, mode: OpenMode) {
  switch (mode.kind) {
    case 'write': {
      database.exec(WRITER_SETTINGS);
      mode.migrate(database);
      break;
    }
    case 'read': {
      database.exec(READER_SETTINGS[mode.cache]);
      break;
    }
    default: {
      // Never reached: TypeScript stops the build here if a kind is added without its own case.
      mode satisfies never;
    }
  }
}
