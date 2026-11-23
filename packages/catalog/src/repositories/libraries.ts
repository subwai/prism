import type { CatalogDatabase } from '#database/catalog-database';
import {
  type StoredSummary,
  storedSummary,
  summaryColumns,
} from '#repositories/items/folder-summaries';
import { excluded } from '#repositories/queries/sql-helpers';
import { libraries } from '#schema/photo-index';
import { desc, eq, ne } from 'drizzle-orm';

/**
 * The number of the library at `root`, added if the catalog has none, and marked as used now. A
 * library added holds nothing yet, which its folder's tile says.
 */
export function registerLibrary(db: CatalogDatabase, root: string): number {
  const [row] = db
    .insert(libraries)
    .values({ covers: '[]', hasEntries: 0, hasSubfolders: 0, root, usedMs: Date.now() })
    .onConflictDoUpdate({ set: { usedMs: excluded(libraries.usedMs) }, target: libraries.root })
    .returning({ library: libraries.library })
    .all();
  if (!row) {
    throw new Error('The catalog returned no row for the library.');
  }
  return row.library;
}

/**
 * The walks that read every folder of a library in full: when the last to get to the end did,
 * and when the one under way began, which the library may have closed during.
 */
export interface FullReads {
  lastMs: number | null;
  startedMs: number | null;
}

/** The walks that read every folder of `library` in full; see `FullReads`. */
export function fullReads(db: CatalogDatabase, library: number): FullReads {
  const [row] = db
    .select({ lastMs: libraries.fullReadMs, startedMs: libraries.fullReadStartedMs })
    .from(libraries)
    .where(eq(libraries.library, library))
    .all();
  return { lastMs: row?.lastMs ?? null, startedMs: row?.startedMs ?? null };
}

/** Notes that a walk that reads every folder of `library` in full began at `at`. */
export function markFullReadStarted(db: CatalogDatabase, library: number, at: number): void {
  db.update(libraries).set({ fullReadStartedMs: at }).where(eq(libraries.library, library)).run();
}

/**
 * Notes that a walk that read every folder of `library` in full got to the end at `at`, so none
 * is under way.
 */
export function markFullRead(db: CatalogDatabase, library: number, at: number): void {
  db.update(libraries)
    .set({ fullReadMs: at, fullReadStartedMs: null })
    .where(eq(libraries.library, library))
    .run();
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

/** Deletes the row of `library`; see `removeLibrary` for the rest of what it holds. */
export function deleteLibrary(db: CatalogDatabase, library: number): void {
  db.delete(libraries).where(eq(libraries.library, library)).run();
}

/** The libraries other than `library`, by their folders' paths. */
export function otherLibraries(
  db: CatalogDatabase,
  library: number,
): { library: number; root: string }[] {
  return db
    .select({ library: libraries.library, root: libraries.root })
    .from(libraries)
    .where(ne(libraries.library, library))
    .all();
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
