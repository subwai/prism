import { type CatalogDatabase, excluded, preparedOnce } from '#photos/catalog/data/database';
import { every } from '#photos/catalog/data/scope';
import { exif } from '#photos/catalog/index-schema';
import type { PhotoExif } from '@prism/shared';
import { eq, lt, sql } from 'drizzle-orm';

/**
 * A photo's details as read from its file at `path`, kept across libraries and sessions while
 * the file has the size and modification time they were read at. A library opened again, or a
 * folder opened as part of another library, finds them here rather than reading every photo.
 */
export interface CachedExif {
  path: string;
  /** The file's place on disk, `dev:ino`, which a rename keeps; some network disks have none. */
  identity: string | null;
  size: number;
  modifiedMs: number;
  exif: PhotoExif;
  usedMs: number;
}

type Row = typeof exif.$inferSelect;

function cachedOf(row: Row): CachedExif {
  return { ...row, exif: JSON.parse(row.exif) as PhotoExif };
}

const byPathQuery = preparedOnce((db) =>
  db
    .select()
    .from(exif)
    .where(eq(exif.path, sql.placeholder('path')))
    .prepare(),
);

/** A file at the `identity` placeholder, with the `size` and `modifiedMs` placeholders' size and time. */
const atPlaceholderIdentity = every(
  eq(exif.identity, sql.placeholder('identity')),
  eq(exif.size, sql.placeholder('size')),
  eq(exif.modifiedMs, sql.placeholder('modifiedMs')),
);

const byIdentityQuery = preparedOnce((db) =>
  db.select().from(exif).where(atPlaceholderIdentity).limit(1).prepare(),
);

/** The details cached for the file at `path`, however it was when they were read. */
export function cachedAt(db: CatalogDatabase, path: string): CachedExif | undefined {
  const row = byPathQuery(db).get({ path });
  return row && cachedOf(row);
}

/** Details cached for a file at `identity` that had this size and time, wherever it was then. */
export function cachedAs(
  db: CatalogDatabase,
  file: { identity: string; size: number; modifiedMs: number },
): CachedExif | undefined {
  const row = byIdentityQuery(db).get(file);
  return row && cachedOf(row);
}

const cacheQuery = preparedOnce((db) =>
  db
    .insert(exif)
    .values({
      exif: sql.placeholder('exif'),
      identity: sql.placeholder('identity'),
      modifiedMs: sql.placeholder('modifiedMs'),
      path: sql.placeholder('path'),
      size: sql.placeholder('size'),
      usedMs: sql.placeholder('usedMs'),
    })
    .onConflictDoUpdate({
      set: {
        exif: excluded(exif.exif),
        identity: excluded(exif.identity),
        modifiedMs: excluded(exif.modifiedMs),
        size: excluded(exif.size),
        usedMs: excluded(exif.usedMs),
      },
      target: exif.path,
    })
    .prepare(),
);

/** Caches `cached`, replacing what was cached at its path. */
export function cacheExif(db: CatalogDatabase, cached: CachedExif): void {
  cacheQuery(db).run({ ...cached, exif: JSON.stringify(cached.exif) });
}

const touchQuery = preparedOnce((db) =>
  db
    .update(exif)
    .set({ usedMs: sql.placeholder('usedMs') })
    .where(eq(exif.path, sql.placeholder('path')))
    .prepare(),
);

/** Marks the details cached at `path` as used at `usedMs`. */
export function touchCached(db: CatalogDatabase, path: string, usedMs: number): void {
  touchQuery(db).run({ path, usedMs });
}

const uncacheQuery = preparedOnce((db) =>
  db
    .delete(exif)
    .where(eq(exif.path, sql.placeholder('path')))
    .prepare(),
);

/** Drops the details cached at `path`. */
export function uncache(db: CatalogDatabase, path: string): void {
  uncacheQuery(db).run({ path });
}

/** Drops the details nothing has used since `usedMs`, such as of photos deleted meanwhile. */
export function uncacheUnused(db: CatalogDatabase, usedMs: number): void {
  db.delete(exif).where(lt(exif.usedMs, usedMs)).run();
}

/** Drops every cached detail. */
export function clearCache(db: CatalogDatabase): void {
  db.delete(exif).run();
}
