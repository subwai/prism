import { KIND_CODES } from '#data/codes';
import { type CatalogDatabase, totalChanges } from '#data/database';
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
import { upsertItem } from '#data/upserts';
import { findReusableDetails, type PhotoFile, type ReadDetails } from '#details/reusable-details';
import { commitWrite, noEffects, type WorkDone, type WriteEffects } from '#writes/commit-write';
import type { PhotoChanges, WriteResult } from '#writes/write-result';
import type { PhotoEntry } from '@prism/shared';
import path from 'node:path';

/** What changes the catalog, applied in order and together. */
export type CatalogWrite =
  /** Entries as a read listed them, or as a change on disk left them. */
  | { kind: 'list'; entries: PhotoEntry[] }
  /** Entries that went, folders with everything inside them. */
  | { kind: 'remove'; ids: string[] }
  /** A folder read to the end, whose rows are now all it holds. */
  | { kind: 'markIndexed'; folderId: string }
  /**
   * A folder's stamp as a read to the end with nothing failing began, at `readMs`, or `null` if
   * one failed.
   */
  | { kind: 'stamp'; folderId: string; stamp: FolderStamp | null; readMs: number }
  /** A walk that reads every folder of the library in full began, at `at`. */
  | { kind: 'startFullRead'; at: number }
  /** A walk that read every folder of the library in full got to the end, at `at`. */
  | { kind: 'finishFullRead'; at: number }
  /** Details read from photos' files. */
  | { kind: 'storeDetails'; details: ReadDetails[] }
  /** Photos whose details could not be read from their files, as they were then. */
  | { kind: 'markUnreadable'; files: UnreadableFile[] }
  /** Photos whose details the catalog may have stored before, as their files are now. */
  | { kind: 'reuseDetails'; photos: PhotoFile[] };

/** The writes that change only photos' details, which most views' orders never read. */
const DETAILS_KINDS = new Set<CatalogWrite['kind']>([
  'markUnreadable',
  'reuseDetails',
  'storeDetails',
]);

/** How many entries a write holds, to tell when enough are waiting. */
export function sizeOf(write: CatalogWrite): number {
  switch (write.kind) {
    case 'list': {
      return write.entries.length;
    }
    case 'remove': {
      return write.ids.length;
    }
    case 'storeDetails': {
      return write.details.length;
    }
    case 'markUnreadable': {
      return write.files.length;
    }
    case 'reuseDetails': {
      return write.photos.length;
    }
    case 'markIndexed':
    case 'stamp':
    case 'startFullRead':
    case 'finishFullRead': {
      return 1;
    }
    // No default
  }
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
  photos: PhotoChanges,
) {
  for (const read of reads) {
    const item = storeDetails(db, library, read);
    if (item !== undefined) {
      photos.changedSinceRead.push(item);
    }
  }
}

/** Marks photos whose details could not be read, noting those whose files changed since. */
function storeUnreadable(
  db: CatalogDatabase,
  library: number,
  files: UnreadableFile[],
  photos: PhotoChanges,
) {
  for (const file of files) {
    const item = setUnreadable(db, library, file) ? undefined : itemOf(db, library, file.id);
    if (item !== undefined) {
      photos.changedSinceRead.push(item);
    }
  }
}

/**
 * Stores the details the catalog kept before of `files`, noting those it has none of; see
 * `findReusableDetails`.
 */
function storeReusableDetails(
  db: CatalogDatabase,
  library: number,
  files: PhotoFile[],
  found: PhotoChanges,
) {
  for (const photo of files) {
    const exif = findReusableDetails(db, library, photo);
    if (!exif) {
      found.toRead.push(photo.id);
      continue;
    }
    const item = storeDetails(db, library, { ...photo, exif });
    if (item !== undefined) {
      found.changedSinceRead.push(item);
    }
  }
}

/**
 * Applies `write`, noting in `done.effects` the folders whose tiles it may change: those an entry
 * came to or left, a folder listed, and one marked read. Details change no tile, as covers are
 * chosen by kind and name.
 */
function applyWrite(db: CatalogDatabase, library: number, write: CatalogWrite, done: WorkDone) {
  const { effects } = done;
  switch (write.kind) {
    case 'list': {
      for (const entry of write.entries) {
        const item = listEntry(db, library, entry, effects);
        if (item !== undefined) {
          done.newlyUnread.push(item);
        }
      }
      return;
    }
    case 'remove': {
      for (const id of write.ids) {
        const folder = removeItem(db, library, id);
        unmarkIndexedInside(db, library, id);
        // IDs are paths inside the library's folder, so a removed entry's folder is its path's.
        effects.folders.add(path.dirname(id));
        if (folder) {
          effects.subfolders.add(path.dirname(id));
        }
      }
      return;
    }
    case 'markIndexed': {
      if (markIndexed(db, library, write.folderId)) {
        effects.read.add(write.folderId);
      }
      effects.folders.add(write.folderId);
      return;
    }
    case 'stamp': {
      stampFolder(db, library, write.folderId, write.stamp);
      if (write.stamp !== null) {
        // Every read of a folder changes when it was read, so a full read of a library that is
        // as the catalog has it would otherwise make every view again as it goes.
        const before = totalChanges(db);
        markRead(db, library, write.folderId, write.readMs);
        effects.unshown += totalChanges(db) - before;
      }
      return;
    }
    case 'startFullRead': {
      markFullReadStarted(db, library, write.at);
      return;
    }
    case 'finishFullRead': {
      markFullRead(db, library, write.at);
      return;
    }
    case 'storeDetails': {
      storeReadDetails(db, library, write.details, done);
      return;
    }
    case 'markUnreadable': {
      storeUnreadable(db, library, write.files, done);
      return;
    }
    case 'reuseDetails': {
      storeReusableDetails(db, library, write.photos, done);
    }
    // No default
  }
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
  return commitWrite(db, library, () => {
    const done: WorkDone = {
      changedSinceRead: [],
      effects: noEffects(),
      newlyUnread: [],
      // A photo found unreadable changes only how far its details got, which views only count.
      onlyDetails: writes.every((write) => DETAILS_KINDS.has(write.kind)),
      toRead: [],
    };
    for (const write of writes) {
      applyWrite(db, library, write, done);
    }
    return done;
  });
}
