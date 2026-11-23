import { entries, folders } from '#database/photo-index/schema';
import { matchAll } from '#repositories/queries/sql-helpers';
import { eq, type Placeholder, sql, type SQL } from 'drizzle-orm';
import path from 'node:path';

/**
 * How the catalog finds an entry from its ID. An ID is a path inside the library's folder, but
 * the catalog keeps an entry by its folder's number and its name, so these turn one into the
 * other, inside the SQL or before it runs.
 */

// The character after the separator, which ends the range of IDs inside a folder.
const AFTER_SEPARATOR = String.fromCodePoint((path.sep.codePointAt(0) ?? 0) + 1);

/**
 * The IDs inside `folderId`, as a range of the index rather than a scan of every row: from its
 * name and a separator up to its name and the character after the separator.
 */
export function pathRangeInside(folderId: string): { start: string; end: string } {
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
  const { start, end } = pathRangeInside(folderId);
  return sql`(SELECT ${folders.folder} FROM ${folders}
      WHERE ${folders.library} = ${library} AND ${folders.path} = ${folderId}
    UNION ALL SELECT ${folders.folder} FROM ${folders}
      WHERE ${folders.library} = ${library} AND ${folders.path} >= ${start}
        AND ${folders.path} < ${end})`;
}

/** The path of the folder an entry is in, which is its parent's ID. */
export const parentPath = sql<string>`(SELECT ${folders.path} FROM ${folders}
  WHERE ${folders.folder} = ${entries.parent})`;

/** The entry at `id` in `library`: its name in its folder, through `entries_name`. */
export function atId(library: number, id: string): SQL {
  const { parentId, name } = placeOf(id);
  return matchAll(eq(entries.parent, folderAt(library, parentId)), eq(entries.name, name));
}

/**
 * The entries at `ids` in `library`, through `entries_name`, however many there are. The `CROSS
 * JOIN` finds each one's folder by its path, where SQLite would read every folder of the
 * library for each.
 */
export function atIds(library: number, ids: readonly string[]): SQL {
  const places = JSON.stringify(
    ids.map((id) => {
      const { parentId, name } = placeOf(id);
      return [parentId, name];
    }),
  );
  return sql`(${entries.parent}, ${entries.name}) IN (
    SELECT ${folders.folder}, value ->> 1 FROM json_each(${places})
    CROSS JOIN ${folders} ON ${folders.library} = ${library} AND ${folders.path} = value ->> 0)`;
}

const placeholderFolder = folderAt(sql.placeholder('library'), sql.placeholder('parentId'));

/**
 * The entry named by the `name` placeholder in the folder at the `parentId` placeholder, in the
 * `library` placeholder's library; `placeOf` gives the two of an ID.
 */
export const atPlaceholderId = matchAll(
  eq(entries.parent, placeholderFolder),
  eq(entries.name, sql.placeholder('name')),
);
