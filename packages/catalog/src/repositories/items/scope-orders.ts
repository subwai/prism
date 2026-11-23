import type { CatalogDatabase } from '#database/catalog-database';
import { pathRangeInside } from '#repositories/queries/entry-ids';
import {
  inScope,
  isWholeLibrary,
  type LibraryIndex,
  readFrom,
  type Scope,
} from '#repositories/queries/scope';
import { parseNumbers } from '#repositories/queries/sql-helpers';
import { folders, items } from '#schema/photo-index';
import type { SortOrder } from '@prism/shared';
import { type SQL, sql } from 'drizzle-orm';

/** A scope's entries in order, and the kind of each as the catalog codes it. */
export interface ScopeOrder {
  items: Int32Array;
  kinds: Uint8Array;
}

/**
 * The order each sort reads entries in: folders first, then by the sort, then by name, then by
 * entry number. The sort by name of a folder's tree goes by folder first; see `byName`.
 */
const ORDER_BY: Record<SortOrder, SQL> = {
  created: sql`${items.grp}, ${items.createdMs}, ${items.nameKey}, ${items.item}`,
  modified: sql`${items.grp}, ${items.modifiedMs}, ${items.nameKey}, ${items.item}`,
  name: sql`${items.grp}, ${items.nameKey}, ${items.item}`,
  size: sql`${items.grp}, ${items.size}, ${items.nameKey}, ${items.item}`,
  taken: sql`${items.grp}, coalesce(${items.takenMs}, ${items.modifiedMs}), ${items.nameKey}, ${items.item}`,
};

/** The sorts a whole library reads straight from an index; the others sort what they read. */
const SORT_INDEXES: Partial<Record<SortOrder, LibraryIndex>> = {
  taken: 'items_taken',
};

/** A query's entries and their kinds, as SQLite gathers them, in the order it reads them. */
function gathered(db: CatalogDatabase, query: SQL) {
  const row = db.get<{ items: string; kinds: string }>(sql`
    SELECT json_group_array(item) AS items, json_group_array(kind) AS kinds FROM (${query})`);
  return { items: parseNumbers(row?.items), kinds: parseNumbers(row?.kinds) };
}

/** The folders of `scope`, which must be recursive: every one of the library, or of a tree. */
function foldersOf(library: number, { directoryId }: Scope): SQL {
  if (directoryId === '.') {
    return sql`${folders.library} = ${library}`;
  }
  // The tree's keys follow its folder's, which leaves out its siblings, and its paths follow
  // its folder's path, which leaves out folders elsewhere whose names fold alike.
  const key = sql`(SELECT tree.key FROM ${folders} AS tree
    WHERE tree.library = ${library} AND tree.path = ${directoryId})`;
  const { start, end } = pathRangeInside(directoryId);
  return sql`${folders.library} = ${library}
    AND ${folders.key} >= ${key} AND ${folders.key} < ${key} || char(2)
    AND (${folders.path} = ${directoryId}
      OR (${folders.path} >= ${start} AND ${folders.path} < ${end}))`;
}

/**
 * Everything inside a folder by name, folder by folder, so a view of the folder's tree keeps
 * each folder's entries together rather than mixing every folder's `1.jpg`: the folders by
 * their keys through `folders_key`, the folder's own first, and each one's entries by name
 * through `items_parent`, with nothing to sort but names alike. Its folders come first, then
 * the rest, as in every order.
 */
function byName(db: CatalogDatabase, library: number, scope: Scope): ScopeOrder {
  const group = (grp: number) =>
    gathered(
      db,
      sql`SELECT ${items.item}, ${items.kind} FROM ${folders} INDEXED BY folders_key
        JOIN ${items} INDEXED BY items_parent
          ON ${items.parent} = ${folders.folder} AND ${items.grp} = ${grp}
        WHERE ${foldersOf(library, scope)}
        ORDER BY ${folders.key}, ${folders.folder}, ${items.nameKey}, ${items.item}`,
    );
  const inFolders = group(0);
  const rest = group(1);
  return {
    items: Int32Array.from([...inFolders.items, ...rest.items]),
    kinds: Uint8Array.from([...inFolders.kinds, ...rest.kinds]),
  };
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
  if (sort === 'name' && scope.recursive) {
    return byName(db, library, scope);
  }
  const index = isWholeLibrary(scope) ? SORT_INDEXES[sort] : undefined;
  const order = gathered(
    db,
    sql`SELECT ${items.item}, ${items.kind} FROM ${readFrom(scope, index)}
      WHERE ${inScope(library, scope)}
      ORDER BY ${ORDER_BY[sort]}`,
  );
  return { items: Int32Array.from(order.items), kinds: Uint8Array.from(order.kinds) };
}
