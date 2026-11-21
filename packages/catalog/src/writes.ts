import { KIND_CODES } from '#data/codes';
import { type CatalogDatabase, totalChanges, transaction } from '#data/database';
import { setDetails, setTags } from '#data/details';
import { forgetSkeleton } from '#data/folder-skeletons';
import {
  type FolderStamp,
  markIndexed,
  markRead,
  stampFolder,
  unmarkIndexedInside,
} from '#data/indexed-folders';
import { itemOf, removeItem } from '#data/items';
import { markFullRead, markFullReadStarted } from '#data/libraries';
import { upsertItem } from '#data/upserts';
import { refreshSummaries } from '#folder-summaries';
import { type PhotoFile, type ReadDetails, recallExif } from '#recalled-details';
import type { PhotoEntry } from '@prism/shared';
import path from 'node:path';

/** What changes the catalog, applied in order and together. */
export type CatalogWrite =
  /** Entries as a read listed them, or as a change on disk left them. */
  | { listed: PhotoEntry[] }
  /** Entries that went, folders with everything inside them. */
  | { removed: string[] }
  /** A folder read to the end, whose rows are now all it holds. */
  | { indexed: string }
  /**
   * A folder's stamp as a read to the end with nothing failing began, at `readMs`, or `null` if
   * one failed.
   */
  | { stamped: string; stamp: FolderStamp | null; readMs: number }
  /** A walk that reads every folder of the library in full began, at this time. */
  | { fullReadStarted: number }
  /** A walk that read every folder of the library in full got to the end, at this time. */
  | { fullRead: number }
  /** Details read from photos' files. */
  | { details: ReadDetails[] }
  /** Photos whose details the catalog may have stored before, as their files are now. */
  | { recalled: PhotoFile[] };

/** How many entries a write holds, to tell when enough are waiting. */
export function sizeOf(write: CatalogWrite) {
  if ('listed' in write) {
    return write.listed.length;
  }
  if ('removed' in write) {
    return write.removed.length;
  }
  if ('details' in write) {
    return write.details.length;
  }
  return 'recalled' in write ? write.recalled.length : 1;
}

/**
 * What the sidebar's tree reads again after a write: the subfolders of `folders`, which it added
 * or removed, and the tiles of `tiles`, which it changed or marked read, in place.
 */
export interface FolderNews {
  folders: string[];
  tiles: string[];
}

/**
 * Photos a write left without details: `missed` as their files changed since they were read,
 * and `unrecalled` as the catalog kept none of theirs before, whose files are for the enricher
 * to read, with what the sidebar's tree reads again (`FolderNews`). `changed` says whether it
 * changed any row, which views may show, and `reshaped` whether it changed what the skeleton
 * shows, so the one kept ready-made went.
 */
export interface Written extends FolderNews {
  missed: number[];
  unread: number[];
  unrecalled: string[];
  changed: boolean;
  reshaped: boolean;
}

/**
 * Stores a photo's details and its tags. Returns the photo's number if its file changed since
 * they were read, so they were left out, and the catalog has it.
 */
function storeDetails(db: CatalogDatabase, library: number, details: ReadDetails) {
  const stored = setDetails(db, library, details);
  const item = itemOf(db, library, details.id);
  if (stored && item !== undefined) {
    setTags(db, library, item, details.exif.tags ?? []);
  }
  return stored ? undefined : item;
}

/**
 * The folders whose tiles a write may change, the files it listed anew, the folders it marked
 * read that were not before, and the folders whose subfolders it added, changed or removed.
 */
export interface Touched {
  folders: Set<string>;
  rewritten: Set<number>;
  read: Set<string>;
  subfolders: Set<string>;
  /** Rows it changed that no view shows, which views need not be made again for. */
  unshown: number;
}

/**
 * Adds or updates an entry. A file that changed loses its details, as they described what it
 * held before, and one listed as the catalog has it changes no tile. Returns the entry's number
 * if it is a photo left without details.
 */
function list(db: CatalogDatabase, library: number, entry: PhotoEntry, touched: Touched) {
  const row = upsertItem(db, library, entry);
  if (row.changed) {
    touched.folders.add(entry.parentId);
    if (row.kind === KIND_CODES.directory) {
      // A folder listed for the first time starts with a tile of its own.
      touched.folders.add(entry.id);
      touched.subfolders.add(entry.parentId);
    } else {
      // Reads list only what is new or changed, so a cover listed has a new thumbnail.
      touched.rewritten.add(row.item);
    }
  }
  return row.kind === KIND_CODES.image && row.exifRead === 0 ? row.item : undefined;
}

/** Stores what was read from photos' files. */
function storeRead(db: CatalogDatabase, library: number, reads: ReadDetails[], written: Written) {
  for (const read of reads) {
    const item = storeDetails(db, library, read);
    if (item !== undefined) {
      written.missed.push(item);
    }
  }
}

/**
 * Stores the details the catalog kept before of `photos`, noting those it has none of; see
 * `recallExif`.
 */
function storeRecalled(
  db: CatalogDatabase,
  library: number,
  photos: PhotoFile[],
  written: Written,
) {
  for (const photo of photos) {
    const exif = recallExif(db, library, photo);
    if (!exif) {
      written.unrecalled.push(photo.id);
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
      const folder = removeItem(db, library, id);
      unmarkIndexedInside(db, library, id);
      // IDs are paths inside the library's folder, so a removed entry's folder is its path's.
      touched.folders.add(path.dirname(id));
      if (folder) {
        touched.subfolders.add(path.dirname(id));
      }
    }
  } else if ('indexed' in write) {
    if (markIndexed(db, library, write.indexed)) {
      touched.read.add(write.indexed);
    }
    touched.folders.add(write.indexed);
  } else if ('stamped' in write) {
    stampFolder(db, library, write.stamped, write.stamp);
    if (write.stamp !== null) {
      // Every read of a folder changes when it was read, so a full read of a library that is
      // as the catalog has it would otherwise make every view again as it goes.
      const before = totalChanges(db);
      markRead(db, library, write.stamped, write.readMs);
      touched.unshown += totalChanges(db) - before;
    }
  } else if ('fullReadStarted' in write) {
    markFullReadStarted(db, library, write.fullReadStarted);
  } else if ('fullRead' in write) {
    markFullRead(db, library, write.fullRead);
  } else if ('details' in write) {
    storeRead(db, library, write.details, written);
  } else {
    storeRecalled(db, library, write.recalled, written);
  }
}

/** Runs `work` in one transaction, with the tiles of the folders it notes it touched. */
export function writeTouching(
  db: CatalogDatabase,
  library: number,
  work: (touched: Touched, written: Written) => void,
): Written {
  const written: Written = {
    changed: false,
    folders: [],
    missed: [],
    reshaped: false,
    tiles: [],
    unread: [],
    unrecalled: [],
  };
  const touched: Touched = {
    folders: new Set(),
    read: new Set(),
    rewritten: new Set(),
    subfolders: new Set(),
    unshown: 0,
  };
  const before = totalChanges(db);
  transaction(db, () => {
    work(touched, written);
    written.tiles = refreshSummaries(db, library, touched.folders, touched.rewritten, touched.read);
    // The skeleton shows every folder, its tile, whether it was read, and its covers' files,
    // whose thumbnails change as they are rewritten, which changes their folders' tiles too.
    written.folders = [...touched.subfolders];
    written.reshaped =
      written.tiles.length > 0 || written.folders.length > 0 || touched.read.size > 0;
    if (written.reshaped) {
      forgetSkeleton(db, library);
    }
  });
  written.changed = totalChanges(db) - touched.unshown > before;
  return written;
}

/**
 * Applies `writes` to `library` in one transaction, with the tiles of the folders they change,
 * and says which photos it left without details: those listed afresh, and those whose details it
 * left out as their files changed. It also says whether it changed any row, which a read that
 * finds everything as the catalog has it does not.
 */
export function writeCatalog(
  db: CatalogDatabase,
  library: number,
  writes: CatalogWrite[],
): Written {
  return writeTouching(db, library, (touched, written) => {
    for (const write of writes) {
      apply(db, library, write, written, touched);
    }
  });
}
