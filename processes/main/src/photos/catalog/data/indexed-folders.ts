import type { CatalogDatabase } from '#photos/catalog/data/database';
import { every, inside } from '#photos/catalog/data/scope';
import { indexedFolders } from '#photos/index-schema';
import { eq, gte, lt } from 'drizzle-orm';

/** Notes that `directoryId` was read to the end, so its rows are all it holds. */
export function markIndexed(db: CatalogDatabase, library: number, directoryId: string): void {
  db.insert(indexedFolders).values({ directoryId, library }).onConflictDoNothing().run();
}

/** Whether `directoryId` was read to the end. */
export function isIndexed(db: CatalogDatabase, library: number, directoryId: string): boolean {
  const [row] = db
    .select({ directoryId: indexedFolders.directoryId })
    .from(indexedFolders)
    .where(every(eq(indexedFolders.library, library), eq(indexedFolders.directoryId, directoryId)))
    .all();
  return row !== undefined;
}

/** Forgets that `directoryId`, and every folder inside it, was read to the end. */
export function unmarkIndexedInside(
  db: CatalogDatabase,
  library: number,
  directoryId: string,
): void {
  const { start, end } = inside(directoryId);
  const inLibrary = eq(indexedFolders.library, library);
  db.delete(indexedFolders)
    .where(every(inLibrary, eq(indexedFolders.directoryId, directoryId)))
    .run();
  // A separate query, as SQLite would scan every row rather than search for either of two.
  db.delete(indexedFolders)
    .where(
      every(inLibrary, gte(indexedFolders.directoryId, start), lt(indexedFolders.directoryId, end)),
    )
    .run();
}
