import { KIND_CODES } from '#data/codes';
import { type CatalogDatabase, totalChanges, transaction } from '#data/database';
import { setDetails, setTags, setUnreadable, type UnreadableFile } from '#data/details';
import {
  type FolderStamp,
  markIndexed,
  markRead,
  stampFolder,
  unmarkIndexedInside,
} from '#data/indexed-folders';
import { itemOf, removeItem } from '#data/items';
import { markFullRead, markFullReadStarted } from '#data/libraries';
import { deleteStoredListing } from '#data/stored-tree-listings';
import { upsertItem } from '#data/upserts';
import { findReusableDetails, type PhotoFile, type ReadDetails } from '#details/reusable-details';
import { refreshSummaries } from '#tree/refresh-summaries';
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
  /** Photos whose details could not be read from their files, as they were then. */
  | { unreadable: UnreadableFile[] }
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
  if ('unreadable' in write) {
    return write.unreadable.length;
  }
  return 'recalled' in write ? write.recalled.length : 1;
}

/** What the sidebar's tree reads again after a write. */
export interface TreeChanges {
  /** Folders whose subfolders the write added or removed. */
  folders: string[];
  /** Folders whose tiles the write changed or marked read. */
  tiles: string[];
}

/** What a write changed, for the writer to report. */
export interface WriteResult extends TreeChanges {
  /**
   * Photos whose details the write left out, as their files changed since they were read or
   * found unreadable.
   */
  changedSinceRead: number[];
  /** Photos listed with no details read yet. */
  newlyUnread: number[];
  /** IDs of photos with no details the catalog could reuse, so the enricher reads their files. */
  toRead: string[];
  /** Whether the write changed any row a view may show. */
  changed: boolean;
  /** Whether all it wrote was photos' details, which most views' orders never read. */
  onlyDetails: boolean;
  /** Whether it changed what the tree listing shows, so the stored listing was deleted. */
  treeChanged: boolean;
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

/** What a write touched, gathered as it goes, to work out what changed once it is done. */
export interface WriteEffects {
  /** Folders whose tiles the write may change. */
  folders: Set<string>;
  /** Files listed anew, whose thumbnails change. */
  rewritten: Set<number>;
  /** Folders newly marked read to the end. */
  read: Set<string>;
  /** Folders whose subfolders the write added, changed or removed. */
  subfolders: Set<string>;
  /** Rows it changed that no view shows, so views need not be built again for them. */
  unshown: number;
}

/**
 * Adds or updates an entry. A file that changed loses its details, as they described what it
 * held before, and one listed as the catalog has it changes no tile. Returns the entry's number
 * if it is a photo left without details.
 */
function listEntry(db: CatalogDatabase, library: number, entry: PhotoEntry, effects: WriteEffects) {
  const row = upsertItem(db, library, entry);
  if (row.changed) {
    effects.folders.add(entry.parentId);
    if (row.kind === KIND_CODES.directory) {
      // A folder listed for the first time starts with a tile of its own.
      effects.folders.add(entry.id);
      effects.subfolders.add(entry.parentId);
    } else {
      // Reads list only what is new or changed, so a cover listed has a new thumbnail.
      effects.rewritten.add(row.item);
    }
  }
  return row.kind === KIND_CODES.image && row.exifRead === 0 ? row.item : undefined;
}

/** Stores what was read from photos' files. */
function storeReadDetails(
  db: CatalogDatabase,
  library: number,
  reads: ReadDetails[],
  written: WriteResult,
) {
  for (const read of reads) {
    const item = storeDetails(db, library, read);
    if (item !== undefined) {
      written.changedSinceRead.push(item);
    }
  }
}

/** Marks photos whose details could not be read, noting those whose files changed since. */
function storeUnreadable(
  db: CatalogDatabase,
  library: number,
  files: UnreadableFile[],
  written: WriteResult,
) {
  for (const file of files) {
    const item = setUnreadable(db, library, file) ? undefined : itemOf(db, library, file.id);
    if (item !== undefined) {
      written.changedSinceRead.push(item);
    }
  }
}

/**
 * Stores the details the catalog kept before of `photos`, noting those it has none of; see
 * `findReusableDetails`.
 */
function storeReusableDetails(
  db: CatalogDatabase,
  library: number,
  photos: PhotoFile[],
  written: WriteResult,
) {
  for (const photo of photos) {
    const exif = findReusableDetails(db, library, photo);
    if (!exif) {
      written.toRead.push(photo.id);
      continue;
    }
    const item = storeDetails(db, library, { ...photo, exif });
    if (item !== undefined) {
      written.changedSinceRead.push(item);
    }
  }
}

/**
 * Applies `write`, noting in `effects` the folders whose tiles it may change: those an entry
 * came to or left, a folder listed, and one marked read. Details change no tile, as covers are
 * chosen by kind and name.
 */
function applyWrite(
  db: CatalogDatabase,
  library: number,
  write: CatalogWrite,
  written: WriteResult,
  effects: WriteEffects,
) {
  if ('listed' in write) {
    for (const entry of write.listed) {
      const item = listEntry(db, library, entry, effects);
      if (item !== undefined) {
        written.newlyUnread.push(item);
      }
    }
  } else if ('removed' in write) {
    for (const id of write.removed) {
      const folder = removeItem(db, library, id);
      unmarkIndexedInside(db, library, id);
      // IDs are paths inside the library's folder, so a removed entry's folder is its path's.
      effects.folders.add(path.dirname(id));
      if (folder) {
        effects.subfolders.add(path.dirname(id));
      }
    }
  } else if ('indexed' in write) {
    if (markIndexed(db, library, write.indexed)) {
      effects.read.add(write.indexed);
    }
    effects.folders.add(write.indexed);
  } else if ('stamped' in write) {
    stampFolder(db, library, write.stamped, write.stamp);
    if (write.stamp !== null) {
      // Every read of a folder changes when it was read, so a full read of a library that is
      // as the catalog has it would otherwise make every view again as it goes.
      const before = totalChanges(db);
      markRead(db, library, write.stamped, write.readMs);
      effects.unshown += totalChanges(db) - before;
    }
  } else if ('fullReadStarted' in write) {
    markFullReadStarted(db, library, write.fullReadStarted);
  } else if ('fullRead' in write) {
    markFullRead(db, library, write.fullRead);
  } else if ('details' in write) {
    storeReadDetails(db, library, write.details, written);
  } else if ('unreadable' in write) {
    storeUnreadable(db, library, write.unreadable, written);
  } else {
    storeReusableDetails(db, library, write.recalled, written);
  }
}

/** Runs `work` in one transaction, with the tiles of the folders it notes it touched. */
export function writeTouching(
  db: CatalogDatabase,
  library: number,
  work: (effects: WriteEffects, written: WriteResult) => void,
): WriteResult {
  const written: WriteResult = {
    changed: false,
    changedSinceRead: [],
    folders: [],
    newlyUnread: [],
    onlyDetails: false,
    tiles: [],
    toRead: [],
    treeChanged: false,
  };
  const effects: WriteEffects = {
    folders: new Set(),
    read: new Set(),
    rewritten: new Set(),
    subfolders: new Set(),
    unshown: 0,
  };
  const before = totalChanges(db);
  transaction(db, () => {
    work(effects, written);
    written.tiles = refreshSummaries(db, library, effects.folders, effects.rewritten, effects.read);
    // The tree listing shows every folder, its tile, whether it was read, and its covers' files,
    // whose thumbnails change as they are rewritten, which changes their folders' tiles too.
    written.folders = [...effects.subfolders];
    written.treeChanged =
      written.tiles.length > 0 || written.folders.length > 0 || effects.read.size > 0;
    if (written.treeChanged) {
      deleteStoredListing(db, library);
    }
  });
  written.changed = totalChanges(db) - effects.unshown > before;
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
): WriteResult {
  return writeTouching(db, library, (effects, written) => {
    for (const write of writes) {
      applyWrite(db, library, write, written, effects);
    }
    // A photo found unreadable changes only how far its details got, which views only count.
    written.onlyDetails = writes.every(
      (write) => 'details' in write || 'recalled' in write || 'unreadable' in write,
    );
  });
}
