import { type Column, inArray, sql, type SQL } from 'drizzle-orm';
import { drizzle, type NodeSQLiteDatabase } from 'drizzle-orm/node-sqlite';
import type { DatabaseSync } from 'node:sqlite';

/**
 * The catalog's data layer: every function in `data/` is one query of the photo index, taking
 * the connection and the library it asks about, and nothing else. What combines them, such as
 * views and writes, lives in the services beside `data/`.
 */
export type CatalogDatabase = NodeSQLiteDatabase;

/** The index's connection, as the data layer queries it. */
export function catalogDatabase(database: DatabaseSync): CatalogDatabase {
  return drizzle({ client: database });
}

/** Runs `write` in one transaction, which takes the write lock from the start. */
export function transaction(db: CatalogDatabase, write: () => void): void {
  db.transaction(write, { behavior: 'immediate' });
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

/**
 * Whether `column` is one of `list`, which goes as one JSON parameter however long it is,
 * where SQLite allows a few thousand, and with one statement text whatever its length.
 */
export function isIn(column: Column, list: readonly (number | string)[]): SQL {
  return inArray(column, sql`(SELECT value FROM json_each(${JSON.stringify(list)}))`);
}

/** Numbers SQLite gathered with `json_group_array`, which is far quicker than a row each. */
export function numbers(json: string | null | undefined): number[] {
  return JSON.parse(json ?? '[]') as number[];
}

/** The value an upsert tried to write to `column`, in its `ON CONFLICT DO UPDATE`. */
export function excluded(column: Column): SQL {
  return sql.raw(`excluded.${column.name}`);
}
