/// <reference types="vite/client" />
import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

// Not Drizzle's own migrator: it reads what was applied before taking the write lock, so two
// workers opening at once would both apply; it reads migrations only from a folder on disk; and
// it doesn't refuse a catalog from a newer build. See `migrate`.

/** Where the migrations applied are recorded, in the table Drizzle's migrator keeps. */
const MIGRATIONS_TABLE = '__drizzle_migrations';

/**
 * How long a database waits for another process's upgrade of it to finish, which on a catalog
 * of millions of entries takes a minute or so, before giving up.
 */
const UPGRADE_WAIT_MS = 10 * 60_000;

/** Each migration's SQL, by its path, as `drizzle-kit generate` wrote it, for each database. */
const INDEX_FILES = import.meta.glob<string>('./photo-index/migrations/*/migration.sql', {
  eager: true,
  import: 'default',
  query: '?raw',
});
const RATINGS_FILES = import.meta.glob<string>('./ratings/migrations/*/migration.sql', {
  eager: true,
  import: 'default',
  query: '?raw',
});

/**
 * Migrations that leave much of the file free, as one that makes a large table afresh, which
 * SQLite only reuses as rows come: once one is applied, the file is vacuumed down to what it
 * holds; see `vacuum`.
 */
const VACUUMING = new Set(['20261116051323_folders', '20261116202947_removed-details']);

/** A database written by a newer build of the app, which this one must not change. */
export class NewerIndexError extends Error {
  override name = 'NewerIndexError';

  constructor(what: string, unknown: string[]) {
    super(`The ${what} has migrations this build does not know: ${unknown.join(', ')}.`);
  }
}

/** A migration's folder name: when it was made, then what it does, such as `20261108_initial`. */
function nameOf(file: string) {
  return file.split('/').at(-2) ?? file;
}

/** When a migration was made, from the `YYYYMMDDHHMMSS` its folder name starts with. */
function madeAt(name: string) {
  const [year, month, day, hour, minute, second] = [0, 4, 6, 8, 10, 12].map((start, at) =>
    Number(name.slice(start, start + (at === 0 ? 4 : 2))),
  );
  return Date.UTC(year ?? 0, (month ?? 1) - 1, day, hour, minute, second);
}

/** The bundled migrations, oldest first, with what Drizzle's migrator records of each. */
function migrations(files: Record<string, string>) {
  return Object.entries(files)
    .map(([file, sql]) => ({
      folderMillis: madeAt(nameOf(file)),
      hash: createHash('sha256').update(sql).digest('hex'),
      name: nameOf(file),
      sql: sql.split('--> statement-breakpoint'),
    }))
    .toSorted((left, right) => left.name.localeCompare(right.name));
}

/** The names of the migrations the database has had. */
function applied(database: DatabaseSync): string[] {
  const table = database
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(MIGRATIONS_TABLE);
  if (!table) {
    return [];
  }
  const rows = database.prepare(`SELECT name FROM ${MIGRATIONS_TABLE}`).all() as {
    name: string;
  }[];
  return rows.map((row) => row.name);
}

/** The migrations of `known` that `had` lacks; see `NewerIndexError` for those it has extra. */
function pending(known: ReturnType<typeof migrations>, had: string[], what: string) {
  const names = new Set(known.map((migration) => migration.name));
  const unknown = had.filter((name) => !names.has(name));
  if (unknown.length > 0) {
    throw new NewerIndexError(what, unknown);
  }
  return known.filter((migration) => !had.includes(migration.name));
}

/**
 * Brings a database's tables up to date, applying in one transaction the migrations of `files`
 * it has not had. A database that a newer build has migrated further is left as it is: see
 * `NewerIndexError`. `upgrading` is called first when a database with tables already has
 * migrations to apply. On a large database that can take a minute; on a new one it takes no
 * time. Once one of `VACUUMING` is applied to a database that had tables, the file is vacuumed too, before
 * this returns, so under the same notice.
 *
 * Drizzle's migrator would do, but it reads what was applied before its transaction takes the
 * write lock, so of two open libraries' photo workers opening the catalog at once, the one waiting would apply again
 * what the other just did. This reads it again holding the lock, which it waits for as long as
 * another's upgrade can take. It keeps Drizzle's table, as Drizzle writes it.
 */
function migrate(
  database: DatabaseSync,
  files: Record<string, string>,
  what: string,
  upgrading: () => void = () => null,
) {
  const known = migrations(files);
  const had = applied(database);
  if (pending(known, had, what).length === 0) {
    return;
  }
  if (had.length > 0) {
    upgrading();
  }
  waitingForUpgrades(database, () => {
    const appliedNow = applyPending(database, known, what);
    if (had.length > 0 && appliedNow.some((name) => VACUUMING.has(name))) {
      vacuum(database, what);
    }
  });
}

/**
 * Runs `upgrade` with the database waiting as long as another process's upgrade can take for
 * the write lock, rather than its usual few seconds, and then sets the usual wait back.
 */
function waitingForUpgrades(database: DatabaseSync, upgrade: () => void) {
  const { timeout } = database.prepare('PRAGMA busy_timeout').get() as { timeout: number };
  database.exec(`PRAGMA busy_timeout = ${UPGRADE_WAIT_MS}`);
  try {
    upgrade();
  } finally {
    database.exec(`PRAGMA busy_timeout = ${timeout}`);
  }
}

/**
 * Applies, in one transaction that holds the write lock from the start, the migrations of
 * `known` the database has not had, read again under the lock. Returns their names.
 */
function applyPending(
  database: DatabaseSync,
  known: ReturnType<typeof migrations>,
  what: string,
): string[] {
  database.exec('BEGIN IMMEDIATE');
  try {
    database.exec(`CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      id INTEGER PRIMARY KEY,
      hash text NOT NULL,
      created_at numeric,
      name text,
      applied_at TEXT
    )`);
    const record = database.prepare(
      `INSERT INTO ${MIGRATIONS_TABLE} (hash, created_at, name, applied_at) VALUES (?, ?, ?, ?)`,
    );
    const appliedAt = new Date().toISOString();
    const toApply = pending(known, applied(database), what);
    for (const migration of toApply) {
      for (const statement of migration.sql) {
        database.exec(statement);
      }
      record.run(migration.hash, migration.folderMillis, migration.name, appliedAt);
    }
    database.exec('COMMIT');
    return toApply.map((migration) => migration.name);
  } catch (error) {
    if (database.isTransaction) {
      database.exec('ROLLBACK');
    }
    throw error;
  }
}

/**
 * Rewrites the database without the pages its migrations left free, so the file shrinks, and
 * the WAL the rewrite went through with it. `VACUUM` cannot run in a transaction, so it follows
 * the migrations' once they are committed, waiting as they do for another library's worker's write, and
 * those waiting for the upgrade wait for it in turn. The migrations are in either way, so a
 * file that cannot be vacuumed, such as one with no room for the copy it makes, is left as it is.
 */
function vacuum(database: DatabaseSync, what: string) {
  try {
    database.exec('VACUUM');
    database.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  } catch (error) {
    process.emitWarning(`The ${what} could not be vacuumed: ${String(error)}`);
  }
}

/** Brings the photo index's tables up to date; see `migrate`. */
export function migrateIndex(database: DatabaseSync, upgrading?: () => void): void {
  migrate(database, INDEX_FILES, 'photo index', upgrading);
}

/** Brings the ratings file's tables up to date; see `migrate`. */
export function migrateRatings(database: DatabaseSync): void {
  migrate(database, RATINGS_FILES, 'ratings file');
}
