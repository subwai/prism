import type { CatalogDatabase } from '#data/database';
import { folderSkeletons } from '#index-schema';
import { eq } from 'drizzle-orm';

/** The tree listing of `library` kept ready-made in `format`, as text; `null` if none is kept. */
export function readStoredListing(
  db: CatalogDatabase,
  library: number,
  format: number,
): string | null {
  const [row] = db
    .select({ body: folderSkeletons.body, format: folderSkeletons.format })
    .from(folderSkeletons)
    .where(eq(folderSkeletons.library, library))
    .all();
  return row?.format === format ? row.body : null;
}

/** Whether a tree listing of `library` in `format` is kept. */
export function hasStoredListing(db: CatalogDatabase, library: number, format: number): boolean {
  const [row] = db
    .select({ format: folderSkeletons.format })
    .from(folderSkeletons)
    .where(eq(folderSkeletons.library, library))
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
  db.insert(folderSkeletons)
    .values({ body, format, library })
    .onConflictDoUpdate({ set: { body, format }, target: folderSkeletons.library })
    .run();
}

/** Deletes the stored tree listing of `library`. Called when a write changes what the tree shows. */
export function deleteStoredListing(db: CatalogDatabase, library: number): void {
  db.delete(folderSkeletons).where(eq(folderSkeletons.library, library)).run();
}
