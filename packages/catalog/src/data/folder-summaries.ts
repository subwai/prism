import { KIND_CODES } from '#data/codes';
import { type CatalogDatabase, isIn, numbers, preparedOnce } from '#data/database';
import { atPlaceholderId } from '#data/items';
import { indexedFolders, items } from '#index-schema';
import { sql } from 'drizzle-orm';

/** A folder's tile as the catalog keeps it on the folder's row: its covers by entry number. */
export interface StoredSummary {
  hasEntries: boolean;
  hasSubfolders: boolean;
  covers: number[];
}

/** A folder's row, with its tile; `summary` is `null` until the writer works it out. */
export interface SummaryRow {
  id: string;
  parentId: string;
  summary: StoredSummary | null;
}

/** The tile columns as a query reads them. */
interface SummaryColumns {
  hasEntries: number | null;
  hasSubfolders: number | null;
  covers: string | null;
}

/** The tile a row's columns hold, or `null` if the writer has yet to work it out. */
export function storedSummary(row: SummaryColumns): StoredSummary | null {
  if (row.covers === null) {
    return null;
  }
  return {
    covers: numbers(row.covers),
    hasEntries: row.hasEntries === 1,
    hasSubfolders: row.hasSubfolders === 1,
  };
}

const summaryAtQuery = preparedOnce((db) =>
  db
    .select({
      covers: items.covers,
      hasEntries: items.hasEntries,
      hasSubfolders: items.hasSubfolders,
      parentId: items.parentId,
    })
    .from(items)
    .where(atPlaceholderId)
    .prepare(),
);

/** The folder at `folderId` and its tile, if the catalog has it. */
export function summaryAt(
  db: CatalogDatabase,
  library: number,
  folderId: string,
): SummaryRow | undefined {
  const row = summaryAtQuery(db).get({ id: folderId, library });
  return row && { id: folderId, parentId: row.parentId, summary: storedSummary(row) };
}

const storeQuery = preparedOnce((db) =>
  db
    .update(items)
    .set({
      covers: sql.placeholder('covers'),
      hasEntries: sql.placeholder('hasEntries'),
      hasSubfolders: sql.placeholder('hasSubfolders'),
    })
    .where(atPlaceholderId)
    .prepare(),
);

/** Keeps `summary` on the row of the folder at `folderId`. */
export function storeSummary(
  db: CatalogDatabase,
  library: number,
  folderId: string,
  summary: StoredSummary,
): void {
  storeQuery(db).run({
    covers: JSON.stringify(summary.covers),
    hasEntries: summary.hasEntries ? 1 : 0,
    hasSubfolders: summary.hasSubfolders ? 1 : 0,
    id: folderId,
    library,
  });
}

/** A folder inside another, and the covers it has, or `null` if not worked out yet. */
interface SubfolderCovers {
  id: string;
  covers: number[] | null;
}

/** The folders directly inside `folderId`, by name, with the covers each has. */
export function subfolderCovers(
  db: CatalogDatabase,
  library: number,
  folderId: string,
): SubfolderCovers[] {
  return db
    .all<{ id: string; covers: string | null }>(
      sql`SELECT ${items.id} AS id, ${items.covers} AS covers
        FROM ${items} INDEXED BY items_parent
        WHERE ${items.library} = ${library} AND ${items.parentId} = ${folderId}
          AND ${items.kind} = ${KIND_CODES.directory}
        ORDER BY ${items.nameKey}`,
    )
    .map((row) => ({ covers: row.covers === null ? null : numbers(row.covers), id: row.id }));
}

/**
 * The covers of the first folder directly inside `folderId`, by name, with any, as stored; none
 * if no folder inside has stored any. Read through `items_lenders`, which holds only folders with
 * covers, in order by name, so it stops at the first. The partial index's condition is written as
 * literals, as a bound parameter would hide it from SQLite.
 */
export function firstLenderCovers(
  db: CatalogDatabase,
  library: number,
  folderId: string,
): number[] {
  const row = db.get<{ covers: string }>(
    sql`SELECT ${items.covers} AS covers FROM ${items} INDEXED BY items_lenders
      WHERE ${items.library} = ${library} AND ${items.parentId} = ${folderId}
        AND ${items.kind} = ${sql.raw(String(KIND_CODES.directory))}
        AND ${items.covers} IS NOT NULL AND ${items.covers} <> '[]'
      ORDER BY ${items.nameKey} LIMIT 1`,
  );
  return row ? numbers(row.covers) : [];
}

/**
 * Up to `limit` folders whose tiles the writer has yet to work out, those listed last first,
 * which are mostly the deepest, so a folder's subfolders tend to come before it. The partial
 * index's condition is written as literals, as a bound parameter would hide it from SQLite.
 */
export function uncoveredFolders(db: CatalogDatabase, library: number, limit: number): string[] {
  return db
    .all<{ id: string }>(
      sql`SELECT ${items.id} AS id FROM ${items} INDEXED BY items_uncovered
        WHERE ${items.library} = ${library}
          AND ${items.kind} = ${sql.raw(String(KIND_CODES.directory))} AND ${items.covers} IS NULL
        ORDER BY ${items.item} DESC LIMIT ${limit}`,
    )
    .map((row) => row.id);
}

/** A folder's tile as a row the window reads has it, and whether the folder was read. */
export interface FolderTileRow {
  id: string;
  summary: StoredSummary | null;
  read: boolean;
}

/** The tiles of the folders at `folderIds`, and whether each was read to the end. */
export function tilesAt(
  db: CatalogDatabase,
  library: number,
  folderIds: string[],
): FolderTileRow[] {
  return db
    .all<SummaryColumns & { id: string; read: number }>(
      sql`SELECT ${items.id} AS id, ${items.hasEntries} AS hasEntries,
        ${items.hasSubfolders} AS hasSubfolders, ${items.covers} AS covers,
        EXISTS (SELECT 1 FROM ${indexedFolders}
          WHERE ${indexedFolders.library} = ${items.library}
            AND ${indexedFolders.directoryId} = ${items.id}) AS read
        FROM ${items}
        WHERE ${items.library} = ${library} AND ${isIn(items.id, folderIds)}`,
    )
    .map((row) => ({ id: row.id, read: row.read === 1, summary: storedSummary(row) }));
}

/** What names a cover's thumbnail, as the sidebar's tree shows it. */
export interface CoverFile {
  item: number;
  id: string;
  kind: 'image' | 'video';
  size: number | null;
  modifiedMs: number | null;
  inode: string | null;
}

/** The files numbered `covers`, in any order, leaving out any that are gone. */
export function coverFiles(db: CatalogDatabase, covers: number[]): CoverFile[] {
  return db
    .select({
      id: items.id,
      inode: items.inode,
      item: items.item,
      kind: items.kind,
      modifiedMs: items.modifiedMs,
      size: items.size,
    })
    .from(items)
    .where(isIn(items.item, covers))
    .all()
    .map((row) => ({
      id: row.id,
      inode: row.inode,
      item: row.item,
      kind: row.kind === KIND_CODES.video ? 'video' : 'image',
      modifiedMs: row.modifiedMs,
      size: row.size,
    }));
}
