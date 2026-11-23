import type { CatalogDatabase } from '#database/catalog-database';
import { treeListings } from '#database/photo-index/schema';
import { eq } from 'drizzle-orm';

/** The tree listing of `library` kept ready-made in `format`, as text; `null` if none is kept. */
export function readStoredTreeListing(
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
export function hasStoredTreeListing(
  db: CatalogDatabase,
  library: number,
  format: number,
): boolean {
  const [row] = db
    .select({ format: treeListings.format })
    .from(treeListings)
    .where(eq(treeListings.library, library))
    .all();
  return row?.format === format;
}

/** Keeps `body` as the tree listing of `library`, in `format`. */
export function writeStoredTreeListing(
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
export function deleteStoredTreeListing(db: CatalogDatabase, library: number): void {
  db.delete(treeListings).where(eq(treeListings.library, library)).run();
}
