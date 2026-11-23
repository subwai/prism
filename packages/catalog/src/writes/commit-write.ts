import { type CatalogDatabase, totalChanges, transaction } from '#database/catalog-database';
import { deleteStoredListing } from '#repositories/tree-listings';
import { refreshSummaries } from '#tree/refresh-summaries';
import type { PhotoChanges, WriteResult } from '#writes/write-result';

/**
 * What a write touched. The write gathers it as it goes, and it is used afterwards to work out
 * what changed.
 */
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

/** What the work inside `commitWrite` did. */
export interface WorkDone extends PhotoChanges {
  effects: WriteEffects;
  /** Whether all it wrote was photos' details, which most views' orders never read. */
  onlyDetails: boolean;
}

/** Effects of a write that has touched nothing yet. */
export function noEffects(): WriteEffects {
  return {
    folders: new Set(),
    read: new Set(),
    rewritten: new Set(),
    subfolders: new Set(),
    unshown: 0,
  };
}

/**
 * Refreshes the tiles of the folders a write touched, and deletes the stored tree listing if the
 * write changed what it shows.
 */
function refreshTree(db: CatalogDatabase, library: number, effects: WriteEffects) {
  const tiles = refreshSummaries(db, library, {
    folderIds: effects.folders,
    read: effects.read,
    rewritten: effects.rewritten,
  });
  // The tree listing shows every folder, its tile, whether it was read, and its covers' files.
  // A rewritten file gets a new thumbnail, so the tiles that show it change too.
  const folders = [...effects.subfolders];
  const treeChanged = tiles.length > 0 || folders.length > 0 || effects.read.size > 0;
  if (treeChanged) {
    deleteStoredListing(db, library);
  }
  return { folders, tiles, treeChanged };
}

/**
 * Runs `work` and refreshes the tiles of the folders it touched, in one transaction, and returns
 * what changed.
 */
export function commitWrite(
  db: CatalogDatabase,
  library: number,
  work: () => WorkDone,
): WriteResult {
  const before = totalChanges(db);
  let result: WriteResult | undefined;
  transaction(db, () => {
    const { effects, ...done } = work();
    const tree = refreshTree(db, library, effects);
    result = { ...done, ...tree, changed: totalChanges(db) - effects.unshown > before };
  });
  // `transaction` runs its work before it returns, or throws.
  return result as WriteResult;
}
