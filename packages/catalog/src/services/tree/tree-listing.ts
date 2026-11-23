import type { CatalogDatabase } from '#database/catalog-database';
import {
  everyFolder,
  type FolderRow,
  foldersAt,
  foldersIn,
} from '#repositories/entries/folder-contents';
import { coverFiles, type StoredSummary } from '#repositories/entries/folder-summaries';
import { indexedFolderIds, isIndexed } from '#repositories/indexed-folders';
import { librarySummary } from '#repositories/libraries';
import {
  hasStoredTreeListing,
  readStoredTreeListing,
  writeStoredTreeListing,
} from '#repositories/tree-listings';
import {
  NO_COVERS,
  packCover,
  packTile,
  type SerializedTreeListing,
  type TreeFolder,
  type TreeFolderCover,
  type TreeFolderTile,
  treeListingToText,
  writeCoverSet,
} from '@prism/shared';

/**
 * Builds the tree listing of `rows`, folders of `library`, with the library's own folder's tile.
 * `isRead` says whether each folder was read to the end.
 *
 * A folder with no photos of its own shows the covers of a subfolder, so the same set of covers
 * often appears on several folders. Each set goes into `covers` once, and a tile points at it.
 * Each cover carries what names its thumbnail. A folder whose tile the writer hasn't worked out
 * yet gets `null`; the writer reports it once it has.
 */
function buildTreeListing(
  db: CatalogDatabase,
  library: number,
  rows: FolderRow[],
  isRead: (id: string) => boolean,
): SerializedTreeListing {
  const root = librarySummary(db, library);
  const shown = new Set([
    ...rows.flatMap((row) => row.summary?.covers ?? []),
    ...(root?.covers ?? []),
  ]);
  const files = new Map(coverFiles(db, [...shown]).map((file) => [file.entry, file]));
  let covers = '';
  const sets = new Map<string, number>();
  function setOf(numbers: number[]) {
    if (numbers.length === 0) {
      return NO_COVERS;
    }
    const key = numbers.join(',');
    let at = sets.get(key);
    if (at === undefined) {
      at = covers.length;
      sets.set(key, at);
      const set = numbers.flatMap((entry): TreeFolderCover[] => {
        const file = files.get(entry);
        return file
          ? [packCover({ ...file, modifiedMs: file.modifiedMs ?? 0, size: file.size ?? 0 })]
          : [];
      });
      covers += writeCoverSet(set);
    }
    return at;
  }
  function tileOf(summary: StoredSummary | null, read: boolean): TreeFolderTile {
    if (!summary) {
      return null;
    }
    const { hasEntries, hasSubfolders } = summary;
    return packTile({ coversAt: setOf(summary.covers), hasEntries, hasSubfolders, read });
  }
  const folders = new Map<string, TreeFolder[]>();
  for (const { id, parentId, name, summary } of rows) {
    const siblings = folders.get(parentId) ?? [];
    siblings.push([id, name, tileOf(summary, isRead(id))]);
    folders.set(parentId, siblings);
  }
  // Worked out before `covers` is returned, because it may add the library's own folder's set.
  const rootTile = tileOf(root, isIndexed(db, library, '.'));
  return { covers, folders: [...folders], root: rootTile };
}

/** Every folder of `library`, for the sidebar's tree, with each folder's tile. */
export function listWholeTree(db: CatalogDatabase, library: number): SerializedTreeListing {
  const read = new Set(indexedFolderIds(db, library));
  return buildTreeListing(db, library, everyFolder(db, library), (id) => read.has(id));
}

/** The folders directly inside each of `parentIds`, for the sidebar's tree. */
export function listSubfolders(
  db: CatalogDatabase,
  library: number,
  parentIds: string[],
): SerializedTreeListing {
  const rows = parentIds.flatMap((id) => foldersIn(db, library, id));
  return buildTreeListing(db, library, rows, (id) => isIndexed(db, library, id));
}

/**
 * The folders at `folderIds`, whose tiles changed, with the library's own folder's tile whether
 * or not `.` is among them.
 */
export function listFoldersById(
  db: CatalogDatabase,
  library: number,
  folderIds: string[],
): SerializedTreeListing {
  const rows = foldersAt(db, library, folderIds);
  return buildTreeListing(db, library, rows, (id) => isIndexed(db, library, id));
}

/**
 * The version of the listing's text that this build writes. It is stored with each listing,
 * because other builds that share the index may write a different shape. Change it whenever
 * `SerializedTreeListing` changes.
 */
export const TREE_LISTING_FORMAT = 2;

/**
 * The whole tree's listing as text, if one is stored. Reading it takes milliseconds, where
 * building it from the folders' rows and covers takes seconds from a cold disk. It also goes
 * between threads as one string rather than many arrays. `null` if none is stored.
 */
export function storedTreeListing(db: CatalogDatabase, library: number): string | null {
  return readStoredTreeListing(db, library, TREE_LISTING_FORMAT);
}

/** The whole tree's listing as text: the stored one, or one built now. */
export function wholeTreeListingText(db: CatalogDatabase, library: number): string {
  return storedTreeListing(db, library) ?? treeListingToText(listWholeTree(db, library));
}

/** Builds and stores the whole tree's listing, unless one is stored already. */
export function storeTreeListing(db: CatalogDatabase, library: number): void {
  if (!hasStoredTreeListing(db, library, TREE_LISTING_FORMAT)) {
    writeStoredTreeListing(
      db,
      library,
      TREE_LISTING_FORMAT,
      treeListingToText(listWholeTree(db, library)),
    );
  }
}
