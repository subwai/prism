import { openSqlite, WRITER_SETTINGS } from '@prism/shared/sqlite';
import type { DatabaseSync } from 'node:sqlite';

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
 * The settings a reader starts with, as SQLite's `PRAGMA` statements: it can only read, and a
 * `large` cache is 64 MB. A writer starts with `WRITER_SETTINGS`, which puts the file in WAL
 * mode, so readers read the last finished write rather than wait for the one under way.
 */
const READER_SETTINGS = {
  large: 'PRAGMA query_only = ON; PRAGMA cache_size = -65536;',
  standard: 'PRAGMA query_only = ON;',
};

/** Opens the database at `file` for `mode`, closing it again if setting it up fails. */
export function openDatabase(file: string, mode: OpenMode): DatabaseSync {
  return openSqlite(file, {
    busyTimeoutMs: BUSY_TIMEOUT_MS,
    setUp: (database) => setUp(database, mode),
  });
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
