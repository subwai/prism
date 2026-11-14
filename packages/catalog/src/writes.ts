import { cacheRead, type PhotoFile, type ReadDetails, recallExif } from '#cached-details';
import { KIND_CODES } from '#data/codes';
import { type CatalogDatabase, transaction } from '#data/database';
import { setDetails, setTags } from '#data/details';
import { markIndexed, unmarkIndexedInside } from '#data/indexed-folders';
import { itemOf, removeItem, upsertItem } from '#data/items';
import { refreshSummaries } from '#folder-summaries';
import type { PhotoEntry, PhotoExif } from '@prism/shared';
import path from 'node:path';

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
 * and `uncached` as the cache had none, whose files are for the enricher to read. `folders` are
 * those holding folders whose tiles it changed, whose subfolders the sidebar's tree reads again.
 */
export interface Written {
  missed: number[];
  unread: number[];
  uncached: string[];
  folders: string[];
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

/** The folders whose tiles a write may change, and the files it listed anew. */
interface Touched {
  folders: Set<string>;
  rewritten: Set<number>;
}

/**
 * Adds or updates an entry. A file that changed loses its details, as they described what it
 * held before. Returns the entry's number if it is a photo left without details.
 */
function list(db: CatalogDatabase, library: number, entry: PhotoEntry, touched: Touched) {
  const row = upsertItem(db, library, entry);
  touched.folders.add(entry.parentId);
  if (row.kind === KIND_CODES.directory) {
    // A folder listed for the first time starts with a tile of its own.
    touched.folders.add(entry.id);
  } else {
    // Reads list only what is new or changed, so a cover listed has a new thumbnail.
    touched.rewritten.add(row.item);
  }
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

/**
 * Applies `write`, noting in `touched` the folders whose tiles it may change: those an entry
 * came to or left, a folder listed, and one marked read. Details change no tile, as covers are
 * chosen by kind and name.
 */
function apply(
  db: CatalogDatabase,
  library: number,
  write: CatalogWrite,
  written: Written,
  touched: Touched,
) {
  if ('listed' in write) {
    for (const entry of write.listed) {
      const item = list(db, library, entry, touched);
      if (item !== undefined) {
        written.unread.push(item);
      }
    }
  } else if ('removed' in write) {
    for (const id of write.removed) {
      removeItem(db, library, id);
      unmarkIndexedInside(db, library, id);
      // IDs are paths inside the library's folder, so a removed entry's folder is its path's.
      touched.folders.add(path.dirname(id));
    }
  } else if ('indexed' in write) {
    markIndexed(db, library, write.indexed);
    touched.folders.add(write.indexed);
  } else if ('details' in write) {
    storeRead(db, library, write.details, written);
  } else {
    storeRecalled(db, library, write.recalled, written);
  }
}

/**
 * Applies `writes` to `library` in one transaction, with the tiles of the folders they change,
 * and says which photos it left without details: those listed afresh, and those whose details it
 * left out as their files changed.
 */
export function writeCatalog(
  db: CatalogDatabase,
  library: number,
  writes: CatalogWrite[],
): Written {
  const written: Written = { folders: [], missed: [], uncached: [], unread: [] };
  const touched: Touched = { folders: new Set(), rewritten: new Set() };
  transaction(db, () => {
    for (const write of writes) {
      apply(db, library, write, written, touched);
    }
    written.folders = refreshSummaries(db, library, touched.folders, touched.rewritten);
  });
  return written;
}
