import { type CatalogDatabase, preparedOnce } from '#database/catalog-database';
import { entries, folders, indexedFolders } from '#database/photo-index/schema';
import { KIND_CODES } from '#repositories/queries/codes';
import {
  atPlaceholderId,
  entryId,
  folderAt,
  parentPath,
  placeOf,
} from '#repositories/queries/entry-ids';
import { isIn, parseNumbers } from '#repositories/queries/sql-helpers';
import { sql } from 'drizzle-orm';

// A file's inode is its number on its disk, which a rename or move keeps.

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
    covers: parseNumbers(row.covers),
    hasEntries: row.hasEntries === 1,
    hasSubfolders: row.hasSubfolders === 1,
  };
}

const summaryAtQuery = preparedOnce((db) =>
  db
    .select({
      covers: entries.covers,
      hasEntries: entries.hasEntries,
      hasSubfolders: entries.hasSubfolders,
    })
    .from(entries)
    .where(atPlaceholderId)
    .prepare(),
);

/** The folder at `folderId` and its tile, if the catalog has it. */
export function summaryAt(
  db: CatalogDatabase,
  library: number,
  folderId: string,
): SummaryRow | undefined {
  const place = placeOf(folderId);
  const row = summaryAtQuery(db).get({ ...place, library });
  return row && { id: folderId, parentId: place.parentId, summary: storedSummary(row) };
}

const storeQuery = preparedOnce((db) =>
  db
    .update(entries)
    .set({
      covers: sql.placeholder('covers'),
      hasEntries: sql.placeholder('hasEntries'),
      hasSubfolders: sql.placeholder('hasSubfolders'),
    })
    .where(atPlaceholderId)
    .prepare(),
);

/** The tile columns that keep `summary`. */
export function summaryColumns(summary: StoredSummary) {
  return {
    covers: JSON.stringify(summary.covers),
    hasEntries: summary.hasEntries ? 1 : 0,
    hasSubfolders: summary.hasSubfolders ? 1 : 0,
  };
}

/** Keeps `summary` on the row of the folder at `folderId`. */
export function storeSummary(
  db: CatalogDatabase,
  library: number,
  folderId: string,
  summary: StoredSummary,
): void {
  storeQuery(db).run({ ...summaryColumns(summary), ...placeOf(folderId), library });
}

/**
 * The covers of the first folder directly inside `folderId`, by name, with any, as stored; none
 * if no folder inside has stored any, a tile not yet worked out counting as none. Read through
 * `entries_folders_with_covers`, which holds only folders with covers, in order by name, so it stops at the
 * first. The partial index's condition is written as literals, as a bound parameter would hide it
 * from SQLite.
 */
export function firstSubfolderCovers(
  db: CatalogDatabase,
  library: number,
  folderId: string,
): number[] {
  const row = db.get<{ covers: string }>(
    sql`SELECT ${entries.covers} AS covers FROM ${entries} INDEXED BY entries_folders_with_covers
      WHERE ${entries.parent} = ${folderAt(library, folderId)}
        AND ${entries.kind} = ${sql.raw(String(KIND_CODES.directory))}
        AND ${entries.covers} IS NOT NULL AND ${entries.covers} <> '[]'
      ORDER BY ${entries.nameKey} LIMIT 1`,
  );
  return row ? parseNumbers(row.covers) : [];
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
      sql`SELECT ${folders.path} AS id, ${entries.hasEntries} AS hasEntries,
        ${entries.hasSubfolders} AS hasSubfolders, ${entries.covers} AS covers,
        EXISTS (SELECT 1 FROM ${indexedFolders}
          WHERE ${indexedFolders.library} = ${folders.library}
            AND ${indexedFolders.directoryId} = ${folders.path}) AS read
        FROM ${folders} JOIN ${entries} ON ${entries.entry} = ${folders.entry}
        WHERE ${folders.library} = ${library} AND ${isIn(folders.path, folderIds)}`,
    )
    .map((row) => ({ id: row.id, read: row.read === 1, summary: storedSummary(row) }));
}

/** What names a cover's thumbnail, as the sidebar's tree shows it. */
export interface CoverFile {
  entry: number;
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
      entry: entries.entry,
      inode: entries.inode,
      kind: entries.kind,
      modifiedMs: entries.modifiedMs,
      name: entries.name,
      parentId: parentPath,
      size: entries.size,
    })
    .from(entries)
    .where(isIn(entries.entry, covers))
    .all()
    .map((row) => ({
      entry: row.entry,
      id: entryId(row.parentId, row.name),
      inode: row.inode,
      kind: row.kind === KIND_CODES.video ? 'video' : 'image',
      modifiedMs: row.modifiedMs,
      size: row.size,
    }));
}
