import { KIND_CODES } from '#data/codes';
import type { CatalogDatabase } from '#data/database';
import { type StoredSummary, storedSummary } from '#data/folder-summaries';
import { atIds } from '#data/items';
import { entryId, every, inScope, parentPath, readFrom, type Scope } from '#data/scope';
import { folders, items } from '#index-schema';
import { eq, inArray, type SQL, sql } from 'drizzle-orm';

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
  return sql`FROM ${readFrom(scope)} WHERE ${every(inScope(library, scope), ...also)}`;
}

/** A folder, as the first group of `items_parent` has it, which reads them by name. */
const isFolder = eq(items.grp, 0);

/** The numbers of the entries directly inside `folderId`, folders first, then by name. */
export function entriesIn(db: CatalogDatabase, library: number, folderId: string): number[] {
  return db
    .all<{ item: number }>(
      sql`SELECT ${items.item} AS item ${fromFolder(library, folderId)}
        ORDER BY ${items.grp}, ${items.nameKey}`,
    )
    .map((row) => row.item);
}

/** The folders directly inside `folderId`, by name. */
export function subfoldersOf(db: CatalogDatabase, library: number, folderId: string): string[] {
  return db
    .all<{ name: string }>(
      sql`SELECT ${items.name} AS name
        ${fromFolder(library, folderId, isFolder)}
        ORDER BY ${items.nameKey}`,
    )
    .map((row) => entryId(folderId, row.name));
}

/** A folder as the sidebar's tree shows it, with its tile; see `folder-summaries.ts`. */
export interface FolderRow {
  id: string;
  parentId: string;
  name: string;
  summary: StoredSummary | null;
}

const folderColumns = sql`${items.name} AS name, ${items.hasEntries} AS hasEntries,
  ${items.hasSubfolders} AS hasSubfolders, ${items.covers} AS covers`;

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
        ORDER BY ${items.nameKey}`,
    )
    .map((row) => folderRow(folderId, row));
}

/**
/**
 * The folders at `folderIds`, in any order, leaving out any the catalog has not. The query names
 * its index, as SQLite would read every folder of the library through `items_kind`.
 */
export function foldersAt(db: CatalogDatabase, library: number, folderIds: string[]): FolderRow[] {
  return db
    .all<FolderColumns & { parentId: string }>(
      sql`SELECT ${parentPath} AS parentId, ${folderColumns} FROM ${items} INDEXED BY items_entry
        WHERE ${every(atIds(library, folderIds), eq(items.kind, KIND_CODES.directory))}`,
    )
    .map((row) => folderRow(row.parentId, row));
}

/**
 * Every folder of the library, siblings by name, as the tree shows them: folder by folder, by
 * their keys through `folders_key`, and each one's folders by name through `items_parent`,
 * whose first group they are, with nothing to sort.
 */
export function everyFolder(db: CatalogDatabase, library: number): FolderRow[] {
  return db
    .all<FolderColumns & { parentId: string }>(
      sql`SELECT ${folders.path} AS parentId, ${folderColumns}
        FROM ${folders} INDEXED BY folders_key
        JOIN ${items} INDEXED BY items_parent
          ON ${items.parent} = ${folders.folder} AND ${items.grp} = 0
        WHERE ${folders.library} = ${library}
        ORDER BY ${folders.key}, ${folders.folder}, ${items.nameKey}`,
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
    sql`SELECT ${items.kind} AS kind ${fromFolder(library, folderId)}
      ORDER BY ${items.grp} LIMIT 1`,
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
  const media = inArray(items.kind, [KIND_CODES.image, KIND_CODES.video]);
  return db
    .all<{ item: number }>(
      sql`SELECT ${items.item} AS item ${fromFolder(library, folderId, media)}
        ORDER BY ${items.kind}, ${items.nameKey} LIMIT ${limit}`,
    )
    .map((row) => row.item);
}
