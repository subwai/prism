import { items } from '#photos/index-schema';
import type { PhotoEntry, SortOrder } from '@prism/shared';
import { and, eq, gte, lt, type SQL, sql } from 'drizzle-orm';
import { drizzle, type NodeSQLiteDatabase } from 'drizzle-orm/node-sqlite';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

/**
 * The catalog's data layer: each function is one query of the photo index, and nothing else.
 * The services that combine them, such as views, live elsewhere.
 */

export type CatalogDatabase = NodeSQLiteDatabase;

/** The index's connection, as the data layer queries it. */
export function catalogDatabase(database: DatabaseSync): CatalogDatabase {
  return drizzle({ client: database });
}

/** Which entries a view draws from: a folder's own, or everything inside it. */
export interface Scope {
  directoryId: string;
  recursive: boolean;
}

/** A scope's entries in order, and the kind of each as the catalog codes it. */
export interface ScopeOrder {
  items: Int32Array;
  kinds: Uint8Array;
}

/** What the catalog knows of an entry, to tell whether a listing of it is different. */
export interface KnownItem {
  id: string;
  kind: PhotoEntry['kind'];
  size: number | null;
  modifiedMs: number | null;
}

const KINDS: PhotoEntry['kind'][] = ['directory', 'image', 'video', 'file'];

// The character after the separator, which ends the range of IDs inside a folder.
const AFTER_SEPARATOR = String.fromCodePoint((path.sep.codePointAt(0) ?? 0) + 1);

/** The order each sort reads entries in: folders first, then by name, then by entry number. */
const ORDER_BY: Record<SortOrder, SQL> = {
  created: sql`grp, created_ms, name_key, item`,
  modified: sql`grp, modified_ms, name_key, item`,
  name: sql`grp, name_key, item`,
  size: sql`grp, size, name_key, item`,
  taken: sql`grp, coalesce(taken_ms, modified_ms), name_key, item`,
};

/** The sorts a whole library reads straight from an index; the others sort what they read. */
const SORT_INDEXES: Partial<Record<SortOrder, SQL>> = {
  name: sql`items_name`,
  taken: sql`items_taken`,
};

/**
 * The table a scope is read from, and through which index. With one library, every index that
 * starts with it looks as good to SQLite as the next, and it picks one that leaves everything
 * to sort, so the queries name theirs.
 */
function source(scope: Scope, sort: SortOrder): SQL {
  let index: SQL | undefined = SORT_INDEXES[sort];
  if (!scope.recursive) {
    index = sql`items_parent`;
  } else if (scope.directoryId !== '.') {
    index = sql`items_id`;
  }
  return index ? sql`${items} INDEXED BY ${index}` : sql`${items}`;
}

/** The entries of `scope` in `library`. */
function inScope(library: number, { directoryId, recursive }: Scope): SQL | undefined {
  if (!recursive) {
    return and(eq(items.library, library), eq(items.parentId, directoryId));
  }
  if (directoryId === '.') {
    return eq(items.library, library);
  }
  return and(
    eq(items.library, library),
    gte(items.id, `${directoryId}${path.sep}`),
    lt(items.id, `${directoryId}${AFTER_SEPARATOR}`),
  );
}

/** Numbers SQLite gathered as a JSON array, which is far quicker than a row each. */
function numbers(json: string | undefined): number[] {
  return JSON.parse(json ?? '[]') as number[];
}

/** What the catalog holds directly inside `directoryId`. */
export function listing(db: CatalogDatabase, library: number, directoryId: string): KnownItem[] {
  const rows = db
    .select({ id: items.id, kind: items.kind, modifiedMs: items.modifiedMs, size: items.size })
    .from(items)
    .where(inScope(library, { directoryId, recursive: false }))
    .all();
  return rows.map(({ id, kind, modifiedMs, size }) => ({
    id,
    kind: KINDS[kind] ?? 'file',
    modifiedMs,
    size,
  }));
}

/**
 * Every entry of `scope` in `sort` order, ascending, with each one's kind. SQLite gathers them
 * into JSON arrays in the order the subquery reads them, as it never flattens a subquery with
 * an `ORDER BY` into an aggregate.
 */
export function scopeOrder(
  db: CatalogDatabase,
  library: number,
  scope: Scope,
  sort: SortOrder,
): ScopeOrder {
  const row = db.get<{ items: string; kinds: string }>(sql`
    SELECT json_group_array(item) AS items, json_group_array(kind) AS kinds FROM (
      SELECT item, kind FROM ${source(scope, sort)}
      WHERE ${inScope(library, scope)}
      ORDER BY ${ORDER_BY[sort]}
    )`);
  return {
    items: Int32Array.from(numbers(row?.items)),
    kinds: Uint8Array.from(numbers(row?.kinds)),
  };
}
