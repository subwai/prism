import {
  cacheRead,
  type PhotoFile,
  type ReadDetails,
  recallExif,
} from '#photos/catalog/cached-details';
import { KIND_CODES } from '#photos/catalog/data/codes';
import { type CatalogDatabase, transaction } from '#photos/catalog/data/database';
import { setDetails, setTags } from '#photos/catalog/data/details';
import { markIndexed, unmarkIndexedInside } from '#photos/catalog/data/indexed-folders';
import { itemOf, removeItem, upsertItem } from '#photos/catalog/data/items';
import type { PhotoEntry, PhotoExif } from '@prism/shared';

/** A photo's details, read while its file had this size and modification time. */
interface PhotoDetails {
  id: string;
  size: number;
  modifiedMs: number;
  exif: PhotoExif;
}

/** What changes the catalog, applied in order and together. */
export type CatalogWrite =
  /** Entries as a read listed them, or as a change on disk left them. */
  | { listed: PhotoEntry[] }
  /** Entries that went, folders with everything inside them. */
  | { removed: string[] }
  /** A folder read to the end, whose rows are now all it holds. */
  | { indexed: string }
  /** Details read from photos' files, which the cache keeps too. */
  | { details: ReadDetails[] }
  /** Photos whose details the cache may have, as their files are now. */
  | { recalled: PhotoFile[] };

/**
 * Photos a write left without details: `missed` as their files changed since they were read,
 * and `uncached` as the cache had none, whose files are for the enricher to read.
 */
export interface Written {
  missed: number[];
  unread: number[];
  uncached: string[];
}

/**
 * Stores a photo's details and its tags. Returns the photo's number if its file changed since
 * they were read, so they were left out, and the catalog has it.
 */
function storeDetails(db: CatalogDatabase, library: number, details: PhotoDetails) {
  const stored = setDetails(db, library, details);
  const item = itemOf(db, library, details.id);
  if (stored && item !== undefined) {
    setTags(db, library, item, details.exif.tags ?? []);
  }
  return stored ? undefined : item;
}

/**
 * Adds or updates an entry. A file that changed loses its details, as they described what it
 * held before. Returns the entry's number if it is a photo left without details.
 */
function list(db: CatalogDatabase, library: number, entry: PhotoEntry) {
  const row = upsertItem(db, library, entry);
  return row.kind === KIND_CODES.image && row.exifRead === 0 ? row.item : undefined;
}

/** Stores what was read from photos' files, and caches it too. */
function storeRead(db: CatalogDatabase, library: number, reads: ReadDetails[], written: Written) {
  for (const read of reads) {
    cacheRead(db, read);
    const item = storeDetails(db, library, read);
    if (item !== undefined) {
      written.missed.push(item);
    }
  }
}

/** Stores the details the cache has of `photos`, noting those it has none of. */
function storeRecalled(
  db: CatalogDatabase,
  library: number,
  photos: PhotoFile[],
  written: Written,
) {
  for (const photo of photos) {
    const exif = recallExif(db, photo);
    if (!exif) {
      written.uncached.push(photo.id);
      continue;
    }
    const item = storeDetails(db, library, { ...photo, exif });
    if (item !== undefined) {
      written.missed.push(item);
    }
  }
}

function apply(db: CatalogDatabase, library: number, write: CatalogWrite, written: Written) {
  if ('listed' in write) {
    for (const entry of write.listed) {
      const item = list(db, library, entry);
      if (item !== undefined) {
        written.unread.push(item);
      }
    }
  } else if ('removed' in write) {
    for (const id of write.removed) {
      removeItem(db, library, id);
      unmarkIndexedInside(db, library, id);
    }
  } else if ('indexed' in write) {
    markIndexed(db, library, write.indexed);
  } else if ('details' in write) {
    storeRead(db, library, write.details, written);
  } else {
    storeRecalled(db, library, write.recalled, written);
  }
}

/**
 * Applies `writes` to `library` in one transaction, and says which photos it left without
 * details: those listed afresh, and those whose details it left out as their files changed.
 */
export function writeCatalog(
  db: CatalogDatabase,
  library: number,
  writes: CatalogWrite[],
): Written {
  const written: Written = { missed: [], uncached: [], unread: [] };
  transaction(db, () => {
    for (const write of writes) {
      apply(db, library, write, written);
    }
  });
  return written;
}
