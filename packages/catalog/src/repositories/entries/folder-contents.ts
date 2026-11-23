import type { CatalogDatabase } from '#database/catalog-database';
import { entries, folders } from '#database/photo-index/schema';
import { type StoredSummary, storedSummary } from '#repositories/entries/folder-summaries';
import { KIND_CODES } from '#repositories/queries/codes';
import { atIds, entryId, parentPath } from '#repositories/queries/entry-ids';
import { inScope, readFrom, type Scope } from '#repositories/queries/scope';
import { matchAll } from '#repositories/queries/sql-helpers';
import { eq, inArray, type SQL, sql } from 'drizzle-orm';

// A scope is the folders a view or query covers: one folder, or it and every folder inside it.

/** A folder's own entries. */
function directlyIn(folderId: string): Scope {
  return { directoryId: folderId, recursive: false };
}

/**
 * The folder's own entries that are `also`, read through the index of entries by parent, which
 * `readFrom` names. Left to choose, SQLite reads the whole library through whichever index
 * spares it the sort, such as every photo by name to find one folder's: a fifth of a second in
 * a library of half a million, on the thread every other read of the catalog waits for.
 */
function fromFolder(library: number, folderId: string, ...also: SQL[]): SQL {
  const scope = directlyIn(folderId);
  return sql`FROM ${readFrom(scope)} WHERE ${matchAll(inScope(library, scope), ...also)}`;
}

/** A folder, as the first group of `entries_parent` has it, which reads them by name. */
const isFolder = eq(entries.grp, 0);

/** The numbers of the entries directly inside `folderId`, folders first, then by name. */
export function entriesIn(db: CatalogDatabase, library: number, folderId: string): number[] {
  return db
    .all<{ entry: number }>(
      sql`SELECT ${entries.entry} AS entry ${fromFolder(library, folderId)}
        ORDER BY ${entries.grp}, ${entries.nameKey}`,
    )
    .map((row) => row.entry);
}

/** The folders directly inside `folderId`, by name. */
export function subfoldersOf(db: CatalogDatabase, library: number, folderId: string): string[] {
  return db
    .all<{ name: string }>(
      sql`SELECT ${entries.name} AS name
        ${fromFolder(library, folderId, isFolder)}
        ORDER BY ${entries.nameKey}`,
    )
    .map((row) => entryId(folderId, row.name));
}

/** A folder as the sidebar's tree shows it, with its tile; see `entries/folder-summaries.ts`. */
export interface FolderRow {
  id: string;
  parentId: string;
  name: string;
  summary: StoredSummary | null;
}

const folderColumns = sql`${entries.name} AS name, ${entries.hasEntries} AS hasEntries,
  ${entries.hasSubfolders} AS hasSubfolders, ${entries.covers} AS covers`;

type FolderColumns = Pick<FolderRow, 'name'> & {
  hasEntries: number | null;
  hasSubfolders: number | null;
  covers: string | null;
};

function folderRow(parentId: string, row: FolderColumns): FolderRow {
  return {
    id: entryId(parentId, row.name),
    name: row.name,
    parentId,
    summary: storedSummary(row),
  };
}

/** The folders directly inside `folderId`, by name, as the tree shows them. */
export function foldersIn(db: CatalogDatabase, library: number, folderId: string): FolderRow[] {
  return db
    .all<FolderColumns>(
      sql`SELECT ${folderColumns}
        ${fromFolder(library, folderId, isFolder)}
        ORDER BY ${entries.nameKey}`,
    )
    .map((row) => folderRow(folderId, row));
}

/**
 * The folders at `folderIds`, in any order, leaving out any the catalog has not. The query names
 * its index, as SQLite would read every folder of the library through `entries_kind`.
 */
export function foldersAt(db: CatalogDatabase, library: number, folderIds: string[]): FolderRow[] {
  return db
    .all<FolderColumns & { parentId: string }>(
      sql`SELECT ${parentPath} AS parentId, ${folderColumns} FROM ${entries} INDEXED BY entries_name
        WHERE ${matchAll(atIds(library, folderIds), eq(entries.kind, KIND_CODES.directory))}`,
    )
    .map((row) => folderRow(row.parentId, row));
}

/**
 * Every folder of the library, siblings by name, as the tree shows them: folder by folder, by
 * their keys through `folders_key`, and each one's folders by name through `entries_parent`,
 * whose first group they are, with nothing to sort.
 */
export function everyFolder(db: CatalogDatabase, library: number): FolderRow[] {
  return db
    .all<FolderColumns & { parentId: string }>(
      sql`SELECT ${folders.path} AS parentId, ${folderColumns}
        FROM ${folders} INDEXED BY folders_key
        JOIN ${entries} INDEXED BY entries_parent
          ON ${entries.parent} = ${folders.folder} AND ${entries.grp} = 0
        WHERE ${folders.library} = ${library}
        ORDER BY ${folders.key}, ${folders.folder}, ${entries.nameKey}`,
    )
    .map((row) => folderRow(row.parentId, row));
}

/** Whether `folderId` holds anything, and whether any of it is a folder. */
export function contentsOf(
  db: CatalogDatabase,
  library: number,
  folderId: string,
): { hasEntries: boolean; hasSubfolders: boolean } {
  const first = db.get<{ kind: number }>(
    sql`SELECT ${entries.kind} AS kind ${fromFolder(library, folderId)}
      ORDER BY ${entries.grp} LIMIT 1`,
  );
  return { hasEntries: first !== undefined, hasSubfolders: first?.kind === KIND_CODES.directory };
}

/** The numbers of up to `limit` photos and videos directly inside `folderId`: photos first. */
export function mediaIn(
  db: CatalogDatabase,
  library: number,
  folderId: string,
  limit: number,
): number[] {
  const media = inArray(entries.kind, [KIND_CODES.image, KIND_CODES.video]);
  return db
    .all<{ entry: number }>(
      sql`SELECT ${entries.entry} AS entry ${fromFolder(library, folderId, media)}
        ORDER BY ${entries.kind}, ${entries.nameKey} LIMIT ${limit}`,
    )
    .map((row) => row.entry);
}
