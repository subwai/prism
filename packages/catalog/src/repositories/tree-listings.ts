import type { CatalogDatabase } from '#database/catalog-database';
import { treeListings } from '#schema/photo-index';
import { eq } from 'drizzle-orm';

/** The tree listing of `library` kept ready-made in `format`, as text; `null` if none is kept. */
export function readStoredListing(
  db: CatalogDatabase,
  library: number,
  format: number,
): string | null {
  const [row] = db
    .select({ body: treeListings.body, format: treeListings.format })
    .from(treeListings)
    .where(eq(treeListings.library, library))
    .all();
  return row?.format === format ? row.body : null;
}

/** Whether a tree listing of `library` in `format` is kept. */
export function hasStoredListing(db: CatalogDatabase, library: number, format: number): boolean {
  const [row] = db
    .select({ format: treeListings.format })
    .from(treeListings)
    .where(eq(treeListings.library, library))
    .all();
  return row?.format === format;
}

/** Keeps `body` as the tree listing of `library`, in `format`. */
export function writeStoredListing(
  db: CatalogDatabase,
  library: number,
  format: number,
  body: string,
): void {
  db.insert(treeListings)
    .values({ body, format, library })
    .onConflictDoUpdate({ set: { body, format }, target: treeListings.library })
    .run();
}

/** Deletes the stored tree listing of `library`. Called when a write changes what the tree shows. */
export function deleteStoredListing(db: CatalogDatabase, library: number): void {
  db.delete(treeListings).where(eq(treeListings.library, library)).run();
}
