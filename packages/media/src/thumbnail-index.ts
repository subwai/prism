import type { ThumbnailIndex } from '#thumbnail-index-file';
import { rebuilds, thumbnails } from '#thumbnail-index-schema';
import { asc, eq, inArray, sql } from 'drizzle-orm';

/**
 * The thumbnail index's data layer: each function is one query, taking the connection and
 * nothing else that is not its subject. `thumbnails.ts` and `thumbnail-upkeep.ts` combine them.
 */

/** A cached thumbnail as pruning knows it. */
export interface IndexedThumbnail {
  key: string;
  size: number;
  usedMs: number;
}

/** Runs `write` in one transaction, which takes the write lock from the start. */
export function transaction(db: ThumbnailIndex, write: () => void): void {
  db.transaction(write, { behavior: 'immediate' });
}

/** Notes thumbnail `key`, as made or found now, keeping the later of its times of use. */
export function recordThumbnail(db: ThumbnailIndex, thumbnail: IndexedThumbnail): void {
  db.insert(thumbnails)
    .values(thumbnail)
    .onConflictDoUpdate({
      set: {
        size: sql`excluded.size`,
        usedMs: sql`max(${thumbnails.usedMs}, excluded.used_ms)`,
      },
      target: thumbnails.key,
    })
    .run();
}

/** Notes thumbnail `key`, found in the folder, unless the index has it already. */
export function recordFound(db: ThumbnailIndex, thumbnail: IndexedThumbnail): void {
  db.insert(thumbnails).values(thumbnail).onConflictDoNothing().run();
}

/** Notes that thumbnail `key` was used at `usedMs`, if the index has it. */
export function touchThumbnail(db: ThumbnailIndex, key: string, usedMs: number): void {
  db.update(thumbnails)
    .set({ usedMs: sql`max(${thumbnails.usedMs}, ${usedMs})` })
    .where(eq(thumbnails.key, key))
    .run();
}

/** Forgets the thumbnails of `keys`, which are gone from the folder or about to be. */
export function forgetThumbnails(db: ThumbnailIndex, keys: readonly string[]): void {
  db.delete(thumbnails).where(inArray(thumbnails.key, keys)).run();
}

/** Forgets every thumbnail, for a cache folder deleted as a whole. */
export function forgetAllThumbnails(db: ThumbnailIndex): void {
  db.delete(thumbnails).run();
}

/** The bytes of every thumbnail the index has. */
export function indexedBytes(db: ThumbnailIndex): number {
  const row = db
    .select({ bytes: sql<number>`coalesce(sum(${thumbnails.size}), 0)` })
    .from(thumbnails)
    .get();
  return row?.bytes ?? 0;
}

/** The `limit` thumbnails used longest ago, oldest first. */
export function leastRecentlyUsed(db: ThumbnailIndex, limit: number): IndexedThumbnail[] {
  return db.select().from(thumbnails).orderBy(asc(thumbnails.usedMs)).limit(limit).all();
}

/** Whether the index has been made from the cache folder, so it holds every thumbnail there. */
export function isRebuilt(db: ThumbnailIndex): boolean {
  return db.select().from(rebuilds).limit(1).get() !== undefined;
}

/** Notes that the index has been made from the cache folder. */
export function markRebuilt(db: ThumbnailIndex, finishedMs: number): void {
  db.insert(rebuilds).values({ finishedMs }).run();
}
