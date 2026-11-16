import { folders, items } from '#index-schema';
import { and, eq, type Placeholder, sql, type SQL } from 'drizzle-orm';
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
  | 'items_rating'
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

/**
 * The ID of the entry named `name` in the folder at `parentId`: the catalog keeps an entry by
 * its folder and its name, and its ID is the two joined, as the indexer lists it.
 */
export function entryId(parentId: string, name: string): string {
  return parentId === '.' ? name : `${parentId}${path.sep}${name}`;
}

/** The folder the entry at `id` is in, and its name, as the catalog keeps it. */
export function placeOf(id: string): { parentId: string; name: string } {
  return { name: path.basename(id), parentId: path.dirname(id) };
}

/** The number of the folder at `folderId` in `library`, or `NULL` if the catalog has none. */
export function folderAt(library: number | Placeholder, folderId: string | Placeholder): SQL {
  return sql`(SELECT ${folders.folder} FROM ${folders}
    WHERE ${folders.library} = ${library} AND ${folders.path} = ${folderId})`;
}

/**
 * The numbers of the folder at `folderId` and every folder inside it, however deep: two
 * searches of `folders_path`, as SQLite would scan every folder rather than search for either.
 */
export function folderAndInside(library: number, folderId: string): SQL {
  const { start, end } = inside(folderId);
  return sql`(SELECT ${folders.folder} FROM ${folders}
      WHERE ${folders.library} = ${library} AND ${folders.path} = ${folderId}
    UNION ALL SELECT ${folders.folder} FROM ${folders}
      WHERE ${folders.library} = ${library} AND ${folders.path} >= ${start}
        AND ${folders.path} < ${end})`;
}

/** The path of the folder an entry is in, which is its parent's ID. */
export const parentPath = sql<string>`(SELECT ${folders.path} FROM ${folders}
  WHERE ${folders.folder} = ${items.parent})`;

/** The entries of `scope` in `library`. */
export function inScope(library: number, scope: Scope): SQL {
  if (!scope.recursive) {
    return every(
      eq(items.library, library),
      eq(items.parent, folderAt(library, scope.directoryId)),
    );
  }
  if (isWholeLibrary(scope)) {
    return eq(items.library, library);
  }
  return every(
    eq(items.library, library),
    sql`${items.parent} IN ${folderAndInside(library, scope.directoryId)}`,
  );
}

/** Every one of `conditions`, which `and` types as possibly none. */
export function every(...conditions: SQL[]): SQL {
  return and(...conditions) ?? sql`1`;
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
