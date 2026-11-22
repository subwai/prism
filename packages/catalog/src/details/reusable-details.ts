import type { CatalogDatabase } from '#data/database';
import { detailsAt } from '#data/details';
import { otherLibraries } from '#data/libraries';
import { dropRemovedBefore, dropRemovedDetailsOf, removedDetailsOf } from '#data/removed-details';
import type { PhotoExif } from '@prism/shared';
import path from 'node:path';

const DAY_MS = 24 * 60 * 60 * 1000;
// The details of rows removed this long ago, such as of photos deleted since, are dropped.
const REMOVED_KEPT_MS = 180 * DAY_MS;

/** A photo as it is on disk now, which details stored before are found by. */
export interface PhotoFile {
  id: string;
  /** Its absolute path. */
  file: string;
  /** Its inode, which a rename keeps, as `inodeOf` spells it: `'0'` where the disk has none. */
  inode: string;
  size: number;
  modifiedMs: number;
}

/** The details read from the photo at `id`, while its file had this size and modification time. */
export interface ReadDetails {
  id: string;
  size: number;
  modifiedMs: number;
  exif: PhotoExif;
}

/** The ID of the file at `file` in the library at `root`, if it is inside it. */
function idIn(root: string, file: string): string | undefined {
  const id = path.relative(root, file);
  const outside = id === '' || id === '..' || id.startsWith(`..${path.sep}`) || path.isAbsolute(id);
  return outside ? undefined : id;
}

/**
 * The details stored before of `photo`, as its file is now, which the library numbered
 * `library` lists afresh: those its row left as it was removed, as when the file was moved or
 * renamed where the app did not see it, or put back from Trash, which the row listing it now
 * takes back; or else those of the same file in another library whose folder holds it.
 */
export function findReusableDetails(
  db: CatalogDatabase,
  library: number,
  photo: PhotoFile,
): PhotoExif | undefined {
  const file = { inode: photo.inode, modifiedMs: photo.modifiedMs, size: photo.size };
  const removed = photo.inode === '0' ? undefined : removedDetailsOf(db, file);
  if (removed) {
    dropRemovedDetailsOf(db, file);
    return removed;
  }
  for (const other of otherLibraries(db, library)) {
    const id = idIn(other.root, photo.file);
    const exif = id === undefined ? undefined : detailsAt(db, other.library, { ...file, id });
    if (exif) {
      return exif;
    }
  }
  return undefined;
}

/** Drops the details of rows removed months ago, which nothing took back. */
export function pruneRemovedDetails(db: CatalogDatabase): void {
  dropRemovedBefore(db, Date.now() - REMOVED_KEPT_MS);
}
