import { type CatalogDatabase, excluded } from '#data/database';
import { indexedFolders, items, itemTags, libraries } from '#index-schema';
import { count, desc, eq, ne } from 'drizzle-orm';

/** The number of the library at `root`, added if the catalog has none, and marked as used now. */
export function registerLibrary(db: CatalogDatabase, root: string): number {
  const [row] = db
    .insert(libraries)
    .values({ root, usedMs: Date.now() })
    .onConflictDoUpdate({ set: { usedMs: excluded(libraries.usedMs) }, target: libraries.root })
    .returning({ library: libraries.library })
    .all();
  if (!row) {
    throw new Error('The catalog returned no row for the library.');
  }
  return row.library;
}

/** The libraries other than the one at `root`, most recently used first. */
export function librariesByUse(db: CatalogDatabase, root: string): number[] {
  return db
    .select({ library: libraries.library })
    .from(libraries)
    .where(ne(libraries.root, root))
    .orderBy(desc(libraries.usedMs))
    .all()
    .map((row) => row.library);
}

/** How many entries the catalog holds of `library`. */
export function countItems(db: CatalogDatabase, library: number): number {
  const [row] = db.select({ count: count() }).from(items).where(eq(items.library, library)).all();
  return row?.count ?? 0;
}

/** Removes `library` and everything the catalog holds of it. */
export function removeLibrary(db: CatalogDatabase, library: number): void {
  db.delete(itemTags).where(eq(itemTags.library, library)).run();
  db.delete(items).where(eq(items.library, library)).run();
  db.delete(indexedFolders).where(eq(indexedFolders.library, library)).run();
  db.delete(libraries).where(eq(libraries.library, library)).run();
}
