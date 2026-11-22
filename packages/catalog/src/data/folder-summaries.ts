import { KIND_CODES } from '#data/codes';
import { type CatalogDatabase, isIn, parseNumbers, preparedOnce } from '#data/database';
import { atPlaceholderId } from '#data/items';
import { entryId, folderAt, parentPath, placeOf } from '#data/scope';
import { folders, indexedFolders, items, libraries } from '#index-schema';
import { eq, sql } from 'drizzle-orm';

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
      covers: items.covers,
      hasEntries: items.hasEntries,
      hasSubfolders: items.hasSubfolders,
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
  const place = placeOf(folderId);
  const row = summaryAtQuery(db).get({ ...place, library });
  return row && { id: folderId, parentId: place.parentId, summary: storedSummary(row) };
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

/** The tile columns that keep `summary`. */
function summaryColumns(summary: StoredSummary) {
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
 * The tile of the library's own folder, which no folder holds, so the library's row keeps it;
 * `null` until the writer works it out.
 */
export function librarySummary(db: CatalogDatabase, library: number): StoredSummary | null {
  const [row] = db
    .select({
      covers: libraries.covers,
      hasEntries: libraries.hasEntries,
      hasSubfolders: libraries.hasSubfolders,
    })
    .from(libraries)
    .where(eq(libraries.library, library))
    .all();
  return row ? storedSummary(row) : null;
}

/** Keeps `summary` on the library's row, as the tile of the library's own folder. */
export function storeLibrarySummary(
  db: CatalogDatabase,
  library: number,
  summary: StoredSummary,
): void {
  db.update(libraries).set(summaryColumns(summary)).where(eq(libraries.library, library)).run();
}

/**
 * The covers of the first folder directly inside `folderId`, by name, with any, as stored; none
 * if no folder inside has stored any, a tile not yet worked out counting as none. Read through
 * `items_lenders`, which holds only folders with covers, in order by name, so it stops at the
 * first. The partial index's condition is written as literals, as a bound parameter would hide it
 * from SQLite.
 */
export function firstSubfolderCovers(
  db: CatalogDatabase,
  library: number,
  folderId: string,
): number[] {
  const row = db.get<{ covers: string }>(
    sql`SELECT ${items.covers} AS covers FROM ${items} INDEXED BY items_lenders
      WHERE ${items.parent} = ${folderAt(library, folderId)}
        AND ${items.kind} = ${sql.raw(String(KIND_CODES.directory))}
        AND ${items.covers} IS NOT NULL AND ${items.covers} <> '[]'
      ORDER BY ${items.nameKey} LIMIT 1`,
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
      sql`SELECT ${folders.path} AS id, ${items.hasEntries} AS hasEntries,
        ${items.hasSubfolders} AS hasSubfolders, ${items.covers} AS covers,
        EXISTS (SELECT 1 FROM ${indexedFolders}
          WHERE ${indexedFolders.library} = ${folders.library}
            AND ${indexedFolders.directoryId} = ${folders.path}) AS read
        FROM ${folders} JOIN ${items} ON ${items.item} = ${folders.item}
        WHERE ${folders.library} = ${library} AND ${isIn(folders.path, folderIds)}`,
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
      inode: items.inode,
      item: items.item,
      kind: items.kind,
      modifiedMs: items.modifiedMs,
      name: items.name,
      parentId: parentPath,
      size: items.size,
    })
    .from(items)
    .where(isIn(items.item, covers))
    .all()
    .map((row) => ({
      id: entryId(row.parentId, row.name),
      inode: row.inode,
      item: row.item,
      kind: row.kind === KIND_CODES.video ? 'video' : 'image',
      modifiedMs: row.modifiedMs,
      size: row.size,
    }));
}
