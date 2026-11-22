import type { CatalogDatabase } from '#data/database';
import { folderSkeletons } from '#index-schema';
import { eq } from 'drizzle-orm';

/** The skeleton of `library` kept ready-made in `format`, as text; `null` if none is kept. */
export function storedSkeleton(
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

/** Whether a skeleton of `library` in `format` is kept. */
export function hasStoredSkeleton(db: CatalogDatabase, library: number, format: number): boolean {
  const [row] = db
    .select({ format: folderSkeletons.format })
    .from(folderSkeletons)
    .where(eq(folderSkeletons.library, library))
    .all();
  return row?.format === format;
}

/** Keeps `body` as the skeleton of `library`, in `format`. */
export function storeSkeleton(
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

/** Forgets the skeleton kept of `library`, as a write changed what it shows. */
export function forgetSkeleton(db: CatalogDatabase, library: number): void {
  db.delete(folderSkeletons).where(eq(folderSkeletons.library, library)).run();
}
