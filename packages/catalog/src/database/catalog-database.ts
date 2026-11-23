import { sql } from 'drizzle-orm';
import { drizzle, type NodeSQLiteDatabase } from 'drizzle-orm/node-sqlite';
import type { DatabaseSync } from 'node:sqlite';

/**
 * A connection as the repositories query it. Every function in `repositories/` is one query,
 * taking the connection and what it asks about, and nothing else. What combines them, such as
 * views and writes, lives in the services in the feature folders beside it.
 */
export type CatalogDatabase = NodeSQLiteDatabase;

/** A database's connection, as the repositories query it. */
export function catalogDatabase(database: DatabaseSync): CatalogDatabase {
  return drizzle({ client: database });
}

/** Runs `write` in one transaction, which takes the write lock from the start. */
export function transaction(db: CatalogDatabase, write: () => void): void {
  db.transaction(write, { behavior: 'immediate' });
}

/**
 * How many rows the connection's writes have inserted, updated or deleted since it opened, so a
 * write can tell whether it changed any.
 */
export function totalChanges(db: CatalogDatabase): number {
  const row = db.get<{ changes: number }>(sql`SELECT total_changes() AS changes`);
  return row?.changes ?? 0;
}

/**
 * A query built and prepared once per connection, for those run once per entry, such as the
 * writes of a library being read. Drizzle prepares a statement anew for every other query.
 */
export function preparedOnce<Query>(
  build: (db: CatalogDatabase) => Query,
): (db: CatalogDatabase) => Query {
  const prepared = new WeakMap<CatalogDatabase, Query>();
  return (db) => {
    let query = prepared.get(db);
    if (query === undefined) {
      query = build(db);
      prepared.set(db, query);
    }
    return query;
  };
}
