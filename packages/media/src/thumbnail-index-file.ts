/// <reference types="vite/client" />
import type { MigrationMeta } from 'drizzle-orm/migrator';
import { drizzle, type NodeSQLiteDatabase } from 'drizzle-orm/node-sqlite';
// Drizzle's migrator for this driver reads the folder at run time, which the built app does not
// ship, so the migrations are bundled and handed to the migrator it uses, as the catalog's are.
import { migrateSync } from 'drizzle-orm/sqlite-core/async/session';
import { createHash } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/**
 * Every folder's worker and the main process share the file. Their writes are a few rows at a
 * time, so one waits at most this long for another's; the main process waits too, so it is short.
 */
const BUSY_TIMEOUT_MS = 1000;

/** Where Drizzle records the migrations it has applied. */
const MIGRATIONS_TABLE = '__drizzle_migrations';

/** Each migration's SQL, by its path, as `drizzle-kit generate` wrote it. */
const FILES = import.meta.glob<string>('./thumbnail-index-migrations/*/migration.sql', {
  eager: true,
  import: 'default',
  query: '?raw',
});

/** The thumbnail index's connection, as `thumbnail-index.ts` queries it. */
export type ThumbnailIndex = NodeSQLiteDatabase;

/** An index written by a newer build of the app, which this one must not change. */
class NewerIndexError extends Error {
  override name = 'NewerIndexError';
}

/** A migration's folder name: when it was made, then what it does, such as `20261113_thumbnails`. */
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

/** The bundled migrations, oldest first, as Drizzle's migrator takes them. */
function migrations(): MigrationMeta[] {
  return Object.entries(FILES)
    .map(([file, sql]) => ({
      bps: true,
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

/** Brings the index's tables up to date, unless a newer build has migrated it further. */
function migrate(database: DatabaseSync) {
  const known = migrations();
  const names = new Set(known.map((migration) => migration.name));
  const unknown = applied(database).filter((name) => !names.has(name));
  if (unknown.length > 0) {
    throw new NewerIndexError(`The thumbnail index has newer migrations: ${unknown.join(', ')}.`);
  }
  // Drizzle's own migrators reach the session the same way; its types keep it to themselves.
  const { session } = drizzle({ client: database }) as unknown as {
    session: Parameters<typeof migrateSync>[1];
  };
  migrateSync(known, session, { migrationsTable: MIGRATIONS_TABLE });
}

function connect(file: string) {
  const database = new DatabaseSync(file, { timeout: BUSY_TIMEOUT_MS });
  try {
    database.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
    migrate(database);
    return drizzle({ client: database });
  } catch (error) {
    database.close();
    throw error;
  }
}

/**
 * Opens the thumbnail index at `file`: started afresh if it cannot be read, as the cache folder
 * can fill it again, or kept in memory this session if it cannot be written, or a newer build
 * migrated it. An index in memory starts empty and is never filled from the folder, so this
 * session leaves pruning to the processes that have the file.
 */
export function openThumbnailIndex(file: string): ThumbnailIndex {
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    return connect(file);
  } catch (error) {
    // A newer build's index is that build's to keep.
    if (!(error instanceof NewerIndexError)) {
      for (const suffix of ['', '-wal', '-shm']) {
        rmSync(`${file}${suffix}`, { force: true });
      }
    }
  }
  try {
    return connect(file);
  } catch (error) {
    process.emitWarning(`The thumbnail index is kept in memory: ${String(error)}`);
    return connect(':memory:');
  }
}
