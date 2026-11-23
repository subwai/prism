import type { CatalogDatabase } from '#database/catalog-database';
import { pathRangeInside } from '#repositories/queries/entry-ids';
import { matchAll } from '#repositories/queries/sql-helpers';
import { indexedFolders } from '#schema/photo-index';
import { eq, gte, lt, sql } from 'drizzle-orm';

/**
 * A folder's own times and inode, which move as an entry comes into it, leaves it or is renamed
 * in it, so a folder whose stamp is as a read stored it holds what that read found, but for files
 * rewritten in place. The change time moves too as a tool sets the folder's times back.
 */
export interface FolderStamp {
  modifiedMs: number;
  changedMs: number;
  inode: string;
}

/**
 * Notes that `directoryId` was read to the end, so its rows are all it holds. Returns whether it
 * was not noted already.
 */
export function markIndexed(db: CatalogDatabase, library: number, directoryId: string): boolean {
  const added = db
    .insert(indexedFolders)
    .values({ directoryId, library })
    .onConflictDoNothing()
    .returning({ directoryId: indexedFolders.directoryId })
    .all();
  return added.length > 0;
}

/** Whether `directoryId` was read to the end. */
export function isIndexed(db: CatalogDatabase, library: number, directoryId: string): boolean {
  const [row] = db
    .select({ directoryId: indexedFolders.directoryId })
    .from(indexedFolders)
    .where(
      matchAll(eq(indexedFolders.library, library), eq(indexedFolders.directoryId, directoryId)),
    )
    .all();
  return row !== undefined;
}

/**
 * Keeps `stamp` as how `directoryId` was when last read to the end with nothing failing, or
 * forgets it with `null`. Only a folder noted as read has one.
 */
export function stampFolder(
  db: CatalogDatabase,
  library: number,
  directoryId: string,
  stamp: FolderStamp | null,
): void {
  const { changedMs = null, inode = null, modifiedMs = null } = stamp ?? {};
  const kept = sql`(${indexedFolders.modifiedMs}, ${indexedFolders.changedMs}, ${indexedFolders.inode})`;
  db.update(indexedFolders)
    .set({ changedMs, inode, modifiedMs })
    .where(
      matchAll(
        eq(indexedFolders.library, library),
        eq(indexedFolders.directoryId, directoryId),
        // Left as it is if it holds `stamp` already, so the write changes no row, which views
        // would be made again for.
        sql`${kept} IS NOT (${modifiedMs}, ${changedMs}, ${inode})`,
      ),
    )
    .run();
}

/**
 * Notes that the read of `directoryId` that began at `at` got to the end with nothing failing,
 * as its stamp says. A failed read leaves it, as the folder was still read in full then.
 */
export function markRead(db: CatalogDatabase, library: number, directoryId: string, at: number) {
  db.update(indexedFolders)
    .set({ readMs: at })
    .where(
      matchAll(eq(indexedFolders.library, library), eq(indexedFolders.directoryId, directoryId)),
    )
    .run();
}

/** When the last read of `directoryId` to the end with nothing failing began, if one did. */
export function folderReadMs(
  db: CatalogDatabase,
  library: number,
  directoryId: string,
): number | null {
  const [row] = db
    .select({ readMs: indexedFolders.readMs })
    .from(indexedFolders)
    .where(
      matchAll(eq(indexedFolders.library, library), eq(indexedFolders.directoryId, directoryId)),
    )
    .all();
  return row?.readMs ?? null;
}

/** How `directoryId` was when last read to the end with nothing failing, if it was. */
export function folderStamp(
  db: CatalogDatabase,
  library: number,
  directoryId: string,
): FolderStamp | null {
  const [row] = db
    .select({
      changedMs: indexedFolders.changedMs,
      inode: indexedFolders.inode,
      modifiedMs: indexedFolders.modifiedMs,
    })
    .from(indexedFolders)
    .where(
      matchAll(eq(indexedFolders.library, library), eq(indexedFolders.directoryId, directoryId)),
    )
    .all();
  const { changedMs = null, inode = null, modifiedMs = null } = row ?? {};
  // Kept or forgotten together, so one missing is all missing.
  if (changedMs === null || inode === null || modifiedMs === null) {
    return null;
  }
  return { changedMs, inode, modifiedMs };
}

/** Every folder of the library read to the end. */
export function indexedFolderIds(db: CatalogDatabase, library: number): string[] {
  return db
    .select({ directoryId: indexedFolders.directoryId })
    .from(indexedFolders)
    .where(eq(indexedFolders.library, library))
    .all()
    .map((row) => row.directoryId);
}

/** Forgets that `directoryId`, and every folder inside it, was read to the end. */
export function unmarkIndexedInside(
  db: CatalogDatabase,
  library: number,
  directoryId: string,
): void {
  const { start, end } = pathRangeInside(directoryId);
  const inLibrary = eq(indexedFolders.library, library);
  db.delete(indexedFolders)
    .where(matchAll(inLibrary, eq(indexedFolders.directoryId, directoryId)))
    .run();
  // A separate query, as SQLite would scan every row rather than search for either of two.
  db.delete(indexedFolders)
    .where(
      matchAll(
        inLibrary,
        gte(indexedFolders.directoryId, start),
        lt(indexedFolders.directoryId, end),
      ),
    )
    .run();
}

/** Moves what is noted of `from`, and every folder inside it, to `to`, as it was renamed or moved. */
export function moveIndexed(db: CatalogDatabase, library: number, from: string, to: string): void {
  const { start, end } = pathRangeInside(from);
  const inLibrary = eq(indexedFolders.library, library);
  const moved = {
    directoryId: sql`${to} || substr(${indexedFolders.directoryId}, length(${from}) + 1)`,
  };
  db.update(indexedFolders)
    .set(moved)
    .where(matchAll(inLibrary, eq(indexedFolders.directoryId, from)))
    .run();
  db.update(indexedFolders)
    .set(moved)
    .where(
      matchAll(
        inLibrary,
        gte(indexedFolders.directoryId, start),
        lt(indexedFolders.directoryId, end),
      ),
    )
    .run();
}

/** Forgets which folders of `library` were read to the end. */
export function deleteIndexedFoldersOfLibrary(db: CatalogDatabase, library: number): void {
  db.delete(indexedFolders).where(eq(indexedFolders.library, library)).run();
}
