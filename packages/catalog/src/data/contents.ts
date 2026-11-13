import { KIND_CODES } from '#data/codes';
import type { CatalogDatabase } from '#data/database';
import { every, inScope, readFrom, type Scope } from '#data/scope';
import { items } from '#index-schema';
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
    .all<{ id: string }>(
      sql`SELECT ${items.id} AS id
        ${fromFolder(library, folderId, eq(items.kind, KIND_CODES.directory))}
        ORDER BY ${items.nameKey}`,
    )
    .map((row) => row.id);
}

/** A folder as the sidebar's tree shows it. */
export interface FolderRow {
  id: string;
  parentId: string;
  name: string;
}

/** The folders directly inside `folderId`, by name, as the tree shows them. */
export function foldersIn(db: CatalogDatabase, library: number, folderId: string): FolderRow[] {
  return db.all<FolderRow>(
    sql`SELECT ${items.id} AS id, ${items.parentId} AS parentId, ${items.name} AS name
      ${fromFolder(library, folderId, eq(items.kind, KIND_CODES.directory))}
      ORDER BY ${items.nameKey}`,
  );
}

/**
 * Every folder of the library, siblings by name, as the tree shows them. Folders alone are the
 * first group of `items_name`, which reads them in that order with nothing to sort.
 */
export function everyFolder(db: CatalogDatabase, library: number): FolderRow[] {
  const scope = { directoryId: '.', recursive: true };
  return db.all<FolderRow>(
    sql`SELECT ${items.id} AS id, ${items.parentId} AS parentId, ${items.name} AS name
      FROM ${readFrom(scope, 'items_name')}
      WHERE ${every(inScope(library, scope), eq(items.grp, 0))}
      ORDER BY ${items.grp}, ${items.nameKey}`,
  );
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
