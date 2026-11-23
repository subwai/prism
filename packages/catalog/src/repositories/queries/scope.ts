import { items } from '#database/photo-index/schema';
import { folderAndInside, folderAt } from '#repositories/queries/entry-ids';
import { matchAll } from '#repositories/queries/sql-helpers';
import { eq, sql, type SQL } from 'drizzle-orm';

/**
 * Which entries a view draws from: a scope is the folders a view or query covers, one folder, or
 * it and every folder inside it.
 */
export interface Scope {
  directoryId: string;
  recursive: boolean;
}

/** The indexes a whole library can be read through; see `readFrom`. */
export type LibraryIndex =
  | 'items_camera'
  | 'items_kind'
  | 'items_lens'
  | 'items_rating'
  | 'items_taken'
  | 'items_unread';

/** Whether `scope` is everything in the library. */
export function isWholeLibrary({ directoryId, recursive }: Scope): boolean {
  return recursive && directoryId === '.';
}

/** The entries of `scope` in `library`. */
export function inScope(library: number, scope: Scope): SQL {
  if (!scope.recursive) {
    return matchAll(
      eq(items.library, library),
      eq(items.parent, folderAt(library, scope.directoryId)),
    );
  }
  if (isWholeLibrary(scope)) {
    return eq(items.library, library);
  }
  return matchAll(
    eq(items.library, library),
    sql`${items.parent} IN ${folderAndInside(library, scope.directoryId)}`,
  );
}

/**
 * `items`, read through the index that suits `scope`: a folder's entries, or those of each of
 * the folders inside it, through `items_parent`, and a whole library through `wholeLibrary`, if
 * given. With one library, every index that starts with it looks as good to SQLite as the next,
 * and it picks one that leaves everything to sort, so queries name theirs.
 */
export function readFrom(scope: Scope, wholeLibrary?: LibraryIndex): SQL {
  if (!isWholeLibrary(scope)) {
    return sql`${items} INDEXED BY items_parent`;
  }
  return wholeLibrary ? sql`${items} INDEXED BY ${sql.raw(wholeLibrary)}` : sql`${items}`;
}
