import type { CatalogDatabase } from '#data/database';
import {
  cachedAs,
  cachedAt,
  type CachedExif,
  cacheExif,
  touchCached,
  uncache,
  uncacheUnused,
} from '#data/exif-cache';
import type { PhotoExif } from '@prism/shared';

const DAY_MS = 24 * 60 * 60 * 1000;
// A hit marks its row as used this often at most, to spare a write for every lookup.
const TOUCH_AFTER_MS = DAY_MS;
// Rows nothing has used for this long, such as of photos deleted meanwhile, are dropped.
const UNUSED_MS = 180 * DAY_MS;

/** A photo as it is on disk now, which its cached details are found by. */
export interface PhotoFile {
  id: string;
  /** Its absolute path. */
  file: string;
  /** Its place on disk, `dev:ino`, which a rename keeps; `null` where the disk has none. */
  identity: string | null;
  size: number;
  modifiedMs: number;
}

/** The details read from a photo's file, as it was when they were read. */
export type ReadDetails = PhotoFile & { exif: PhotoExif };

/** The place on disk of a file `stat` describes, if the disk gives it one. */
export function identityOf({ dev, ino }: { dev: number; ino: number }): string | null {
  return ino ? `${dev}:${ino}` : null;
}

/** Whether `cached` was read from a file of `photo`'s size and modification time. */
function matches(cached: CachedExif | undefined, photo: PhotoFile) {
  return cached?.size === photo.size && cached.modifiedMs === photo.modifiedMs;
}

/**
 * The details cached for `photo` as its file is now: at its path, or else at its place on
 * disk, as a file renamed or moved into the library keeps that. Cached details move with their
 * file, and are marked as used now and then.
 */
export function recallExif(db: CatalogDatabase, photo: PhotoFile): PhotoExif | undefined {
  const atPath = cachedAt(db, photo.file);
  const cached =
    matches(atPath, photo) || photo.identity === null
      ? atPath
      : cachedAs(db, { ...photo, identity: photo.identity });
  if (!cached || !matches(cached, photo)) {
    return undefined;
  }
  const now = Date.now();
  if (cached.path !== photo.file) {
    uncache(db, cached.path);
    cacheExif(db, { ...cached, identity: photo.identity, path: photo.file, usedMs: now });
  } else if (now - cached.usedMs > TOUCH_AFTER_MS) {
    touchCached(db, photo.file, now);
  }
  return cached.exif;
}

/** Caches what was read from a photo's file, for whichever library lists it next. */
export function cacheRead(db: CatalogDatabase, read: ReadDetails): void {
  const { exif, file, identity, modifiedMs, size } = read;
  cacheExif(db, { exif, identity, modifiedMs, path: file, size, usedMs: Date.now() });
}

/** Drops cached details nothing has used for months. */
export function pruneExifCache(db: CatalogDatabase): void {
  uncacheUnused(db, Date.now() - UNUSED_MS);
}
