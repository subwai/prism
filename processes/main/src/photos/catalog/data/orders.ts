import { type CatalogDatabase, numbers } from '#photos/catalog/data/database';
import {
  inScope,
  isWholeLibrary,
  type LibraryIndex,
  readFrom,
  type Scope,
} from '#photos/catalog/data/scope';
import { items } from '#photos/index-schema';
import type { SortOrder } from '@prism/shared';
import { type SQL, sql } from 'drizzle-orm';

/** A scope's entries in order, and the kind of each as the catalog codes it. */
export interface ScopeOrder {
  items: Int32Array;
  kinds: Uint8Array;
}

/** The order each sort reads entries in: folders first, then by name, then by entry number. */
const ORDER_BY: Record<SortOrder, SQL> = {
  created: sql`${items.grp}, ${items.createdMs}, ${items.nameKey}, ${items.item}`,
  modified: sql`${items.grp}, ${items.modifiedMs}, ${items.nameKey}, ${items.item}`,
  name: sql`${items.grp}, ${items.nameKey}, ${items.item}`,
  size: sql`${items.grp}, ${items.size}, ${items.nameKey}, ${items.item}`,
  taken: sql`${items.grp}, coalesce(${items.takenMs}, ${items.modifiedMs}), ${items.nameKey}, ${items.item}`,
};

/** The sorts a whole library reads straight from an index; the others sort what they read. */
const SORT_INDEXES: Partial<Record<SortOrder, LibraryIndex>> = {
  name: 'items_name',
  taken: 'items_taken',
};

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
  const index = isWholeLibrary(scope) ? SORT_INDEXES[sort] : undefined;
  const row = db.get<{ items: string; kinds: string }>(sql`
    SELECT json_group_array(item) AS items, json_group_array(kind) AS kinds FROM (
      SELECT ${items.item}, ${items.kind} FROM ${readFrom(scope, index)}
      WHERE ${inScope(library, scope)}
      ORDER BY ${ORDER_BY[sort]}
    )`);
  return {
    items: Int32Array.from(numbers(row?.items)),
    kinds: Uint8Array.from(numbers(row?.kinds)),
  };
}
