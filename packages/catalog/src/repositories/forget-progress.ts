import type { CatalogDatabase } from '#database/catalog-database';
import { forgetProgress } from '#database/photo-index/schema';
import { eq } from 'drizzle-orm';

// The one row the table holds while a forget is under way.
const ROW = 1;

/** Notes that a forget of every photo's details starts, from the first entry. */
export function startForgetProgress(db: CatalogDatabase): void {
  db.insert(forgetProgress)
    .values({ doneThrough: 0, id: ROW })
    .onConflictDoUpdate({ set: { doneThrough: 0 }, target: forgetProgress.id })
    .run();
}

/** The last entry number a forget under way has done, or `null` if none is under way. */
export function readForgetProgress(db: CatalogDatabase): number | null {
  const [row] = db
    .select({ doneThrough: forgetProgress.doneThrough })
    .from(forgetProgress)
    .where(eq(forgetProgress.id, ROW))
    .all();
  return row?.doneThrough ?? null;
}

/** Notes that the forget under way has done every entry up to `doneThrough`. */
export function storeForgetProgress(db: CatalogDatabase, doneThrough: number): void {
  db.update(forgetProgress).set({ doneThrough }).where(eq(forgetProgress.id, ROW)).run();
}

/** Notes that no forget is under way any more. */
export function clearForgetProgress(db: CatalogDatabase): void {
  db.delete(forgetProgress).run();
}
