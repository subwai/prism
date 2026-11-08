import { items } from '#index-schema';
import { and, eq, gte, lt, sql, type SQL } from 'drizzle-orm';
import path from 'node:path';

/** Which entries a view draws from: a folder's own, or everything inside it. */
export interface Scope {
  directoryId: string;
  recursive: boolean;
}

/** The indexes a whole library can be read through; see `readFrom`. */
export type LibraryIndex =
  | 'items_camera'
  | 'items_kind'
  | 'items_lens'
  | 'items_name'
  | 'items_taken'
  | 'items_unread';

// The character after the separator, which ends the range of IDs inside a folder.
const AFTER_SEPARATOR = String.fromCodePoint((path.sep.codePointAt(0) ?? 0) + 1);

/** Whether `scope` is everything in the library. */
export function isWholeLibrary({ directoryId, recursive }: Scope): boolean {
  return recursive && directoryId === '.';
}

/**
 * The IDs inside `folderId`, as a range of the index rather than a scan of every row: from its
 * name and a separator up to its name and the character after the separator.
 */
export function inside(folderId: string): { start: string; end: string } {
  return { end: `${folderId}${AFTER_SEPARATOR}`, start: `${folderId}${path.sep}` };
}

/** The entries of `scope` in `library`. */
export function inScope(library: number, scope: Scope): SQL {
  if (!scope.recursive) {
    return every(eq(items.library, library), eq(items.parentId, scope.directoryId));
  }
  if (isWholeLibrary(scope)) {
    return eq(items.library, library);
  }
  const { start, end } = inside(scope.directoryId);
  return every(eq(items.library, library), gte(items.id, start), lt(items.id, end));
}

/** Every one of `conditions`, which `and` types as possibly none. */
export function every(...conditions: SQL[]): SQL {
  return and(...conditions) ?? sql`1`;
}

/**
 * `items`, read through the index that suits `scope`: a folder's own entries through
 * `items_parent`, a folder's tree through the range of `items_id`, and a whole library through
 * `wholeLibrary`, if given. With one library, every index that starts with it looks as good to
 * SQLite as the next, and it picks one that leaves everything to sort, so queries name theirs.
 */
export function readFrom(scope: Scope, wholeLibrary?: LibraryIndex): SQL {
  if (!scope.recursive) {
    return sql`${items} INDEXED BY items_parent`;
  }
  if (!isWholeLibrary(scope)) {
    return sql`${items} INDEXED BY items_id`;
  }
  return wholeLibrary ? sql`${items} INDEXED BY ${sql.raw(wholeLibrary)}` : sql`${items}`;
}
