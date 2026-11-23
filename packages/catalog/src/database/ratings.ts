import { migrateRatings } from '#database/migrate';
import { openDatabase } from '#database/open-database';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

/** The ratings file's name, beside the photo index in the app's data. */
export const RATINGS_FILE_NAME = 'ratings.db';

/** Opens the ratings file at `file`, bringing its tables up to date. */
export function connectRatings(file: string): DatabaseSync {
  return openDatabase(file, { kind: 'write', migrate: migrateRatings });
}

/** Opens the ratings file at `file` to read only, beside the connection that writes it. */
export function readRatings(file: string): DatabaseSync {
  return openDatabase(file, { cache: 'standard', kind: 'read' });
}

/**
 * The ratings file to keep ratings in: `file`, or `:memory:` for this session only if it cannot
 * be opened. Unlike the photo index, it is the only copy of what it holds, so a file that
 * cannot be read, or that a newer build migrated, is left as it is rather than started afresh.
 */
export function prepareRatings(file: string): string {
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    connectRatings(file).close();
    return file;
  } catch (error) {
    process.emitWarning(`Ratings are kept in memory this session: ${String(error)}`);
    return ':memory:';
  }
}
