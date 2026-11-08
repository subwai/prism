/// <reference types="vite/client" />
import type { MigrationMeta } from 'drizzle-orm/migrator';
import { drizzle } from 'drizzle-orm/node-sqlite';
// Drizzle's migrator for this driver reads the folder at run time, which the built app does not
// ship, so the migrations are bundled and handed to the migrator it uses, as its Bun one does.
import { migrateSync } from 'drizzle-orm/sqlite-core/async/session';
import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

/** Where Drizzle records the migrations it has applied. */
const MIGRATIONS_TABLE = '__drizzle_migrations';

/** Each migration's SQL, by its path, as `drizzle-kit generate` wrote it. */
const FILES = import.meta.glob<string>('./migrations/*/migration.sql', {
  eager: true,
  import: 'default',
  query: '?raw',
});

/** A database written by a newer build of the app, which this one must not change. */
export class NewerIndexError extends Error {
  override name = 'NewerIndexError';

  constructor(unknown: string[]) {
    super(`The photo index has migrations this build does not know: ${unknown.join(', ')}.`);
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

/**
 * Brings the photo index's tables up to date, applying in one transaction the migrations it has
 * not had. One a newer build has migrated further is left as it is: see `NewerIndexError`.
 */
export function migrateIndex(database: DatabaseSync): void {
  const known = migrations();
  const names = new Set(known.map((migration) => migration.name));
  const unknown = applied(database).filter((name) => !names.has(name));
  if (unknown.length > 0) {
    throw new NewerIndexError(unknown);
  }
  // Drizzle's own migrators reach the session the same way; its types keep it to themselves.
  const { session } = drizzle({ client: database }) as unknown as {
    session: Parameters<typeof migrateSync>[1];
  };
  migrateSync(known, session, { migrationsTable: MIGRATIONS_TABLE });
}
