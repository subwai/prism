import { everyFolder, type FolderRow, foldersAt, foldersIn } from '#data/contents';
import type { CatalogDatabase } from '#data/database';
import { coverFiles, librarySummary, type StoredSummary } from '#data/folder-summaries';
import { indexedFolderIds, isIndexed } from '#data/indexed-folders';
import { hasStoredSkeleton, storedSkeleton, storeSkeleton } from '#data/stored-tree-listings';
import {
  type TreeFolder,
  type TreeFolderCover,
  type TreeFolderTile,
  type TreeListing,
  treeListingToText,
} from '@prism/shared';

/**
 * The skeleton of `rows` of `library`, each with whether it was read to the end, by `isRead`,
 * and the library's folder's tile. Each set of covers goes once, as a folder that borrows them
 * shares them with the folders they come from, and each cover as what names its thumbnail. A
 * folder whose tile the writer has yet to work out is sent as unknown; the writer tells of it
 * once it has.
 */
function skeletonOf(
  db: CatalogDatabase,
  library: number,
  rows: FolderRow[],
  isRead: (id: string) => boolean,
): TreeListing {
  const root = librarySummary(db, library);
  const shown = new Set([
    ...rows.flatMap((row) => row.summary?.covers ?? []),
    ...(root?.covers ?? []),
  ]);
  const files = new Map(coverFiles(db, [...shown]).map((file) => [file.item, file]));
  let covers = '';
  const sets = new Map<string, number>();
  function setOf(numbers: number[]) {
    if (numbers.length === 0) {
      return -1;
    }
    const key = numbers.join(',');
    let at = sets.get(key);
    if (at === undefined) {
      at = covers.length;
      sets.set(key, at);
      const set = numbers.flatMap((item): TreeFolderCover[] => {
        const file = files.get(item);
        return file ? [[file.id, file.kind, file.size ?? 0, file.modifiedMs ?? 0, file.inode]] : [];
      });
      covers += `${JSON.stringify(set)}\n`;
    }
    return at;
  }
  function tileOf(summary: StoredSummary | null, read: boolean): TreeFolderTile {
    return summary
      ? [summary.hasEntries, summary.hasSubfolders, setOf(summary.covers), read]
      : null;
  }
  const folders = new Map<string, TreeFolder[]>();
  for (const { id, parentId, name, summary } of rows) {
    const siblings = folders.get(parentId) ?? [];
    siblings.push([id, name, tileOf(summary, isRead(id))]);
    folders.set(parentId, siblings);
  }
  // Before `covers` is read, as it may add the library's folder's set.
  const rootTile = tileOf(root, isIndexed(db, library, '.'));
  return { covers, folders: [...folders], root: rootTile };
}

/**
 * The folders of `library` the catalog knows, for the sidebar's tree: every one of them, or
 * those directly inside each of `parentIds`, with each folder's tile, the library's folder's
 * too.
 */
export function folderSkeleton(
  db: CatalogDatabase,
  library: number,
  parentIds?: string[],
): TreeListing {
  if (!parentIds) {
    const read = new Set(indexedFolderIds(db, library));
    return skeletonOf(db, library, everyFolder(db, library), (id) => read.has(id));
  }
  const rows = parentIds.flatMap((id) => foldersIn(db, library, id));
  return skeletonOf(db, library, rows, (id) => isIndexed(db, library, id));
}

/**
 * The folders at `folderIds` of `library`, whose tiles changed, as `folderSkeleton` has them, and
 * the library's folder's tile, `.` among them or not.
 */
export function folderTiles(
  db: CatalogDatabase,
  library: number,
  folderIds: string[],
): TreeListing {
  const rows = foldersAt(db, library, folderIds);
  return skeletonOf(db, library, rows, (id) => isIndexed(db, library, id));
}

/**
 * The shape of the skeleton's text as this build sends it, kept with each skeleton stored, as
 * other builds that share the index may store theirs otherwise. Change it with `TreeListing`.
 */
export const SKELETON_FORMAT = 2;

/**
 * Every folder of `library` as `folderSkeleton` has them, as text, if kept ready-made: it reads
 * in milliseconds, where reading the folders' rows and covers takes seconds from a cold disk,
 * and goes between threads as one string rather than many arrays. `null` if none is kept.
 */
export function keptSkeleton(db: CatalogDatabase, library: number): string | null {
  return storedSkeleton(db, library, SKELETON_FORMAT);
}

/** Every folder of `library` as `folderSkeleton` has them, as text: the one kept, or made now. */
export function skeletonText(db: CatalogDatabase, library: number): string {
  return keptSkeleton(db, library) ?? treeListingToText(folderSkeleton(db, library));
}

/** Makes the skeleton of `library` ready-made, unless it is already. */
export function keepSkeleton(db: CatalogDatabase, library: number): void {
  if (!hasStoredSkeleton(db, library, SKELETON_FORMAT)) {
    storeSkeleton(db, library, SKELETON_FORMAT, treeListingToText(folderSkeleton(db, library)));
  }
}
