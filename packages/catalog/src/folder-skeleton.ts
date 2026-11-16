import { everyFolder, type FolderRow, foldersAt, foldersIn } from '#data/contents';
import type { CatalogDatabase } from '#data/database';
import { hasStoredSkeleton, storedSkeleton, storeSkeleton } from '#data/folder-skeletons';
import { coverFiles, librarySummary, type StoredSummary } from '#data/folder-summaries';
import { indexedFolderIds, isIndexed } from '#data/indexed-folders';
import type { FolderSkeleton, SkeletonCover, SkeletonTile } from '@prism/shared';

/**
 * The skeleton of `rows` of `library`, with which of them were `listed`, and the library's
 * folder's tile. Each set of covers goes once, as a folder that borrows them shares them with the
 * folders they come from, and each cover as what names its thumbnail. A folder whose tile the
 * writer has yet to work out is sent as unknown; the writer tells of it once it has.
 */
function skeletonOf(
  db: CatalogDatabase,
  library: number,
  rows: FolderRow[],
  listed: string[],
): FolderSkeleton {
  const root = librarySummary(db, library);
  const shown = new Set([
    ...rows.flatMap((row) => row.summary?.covers ?? []),
    ...(root?.covers ?? []),
  ]);
  const files = new Map(coverFiles(db, [...shown]).map((file) => [file.item, file]));
  const covers: SkeletonCover[][] = [];
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
      covers.push(
        numbers.flatMap((item): SkeletonCover[] => {
          const file = files.get(item);
          return file
            ? [[file.id, file.kind, file.size ?? 0, file.modifiedMs ?? 0, file.inode]]
            : [];
        }),
      );
    }
    return at;
  }
  function tileOf(summary: StoredSummary | null): SkeletonTile {
    return summary ? [summary.hasEntries, summary.hasSubfolders, setOf(summary.covers)] : null;
  }
  const folders = rows.map(
    ({ id, parentId, name, summary }) =>
      [id, parentId, name, tileOf(summary)] satisfies FolderSkeleton['folders'][number],
  );
  return { covers, folders, listed, root: [tileOf(root), isIndexed(db, library, '.')] };
}

/**
 * The folders of `library` the catalog knows, for the sidebar's tree: every one of them, or
 * those directly inside each of `parentIds`, with which of them were read to the end, and each
 * folder's tile, the library's folder's too.
 */
export function folderSkeleton(
  db: CatalogDatabase,
  library: number,
  parentIds?: string[],
): FolderSkeleton {
  if (!parentIds) {
    return skeletonOf(db, library, everyFolder(db, library), indexedFolderIds(db, library));
  }
  const rows = parentIds.flatMap((id) => foldersIn(db, library, id));
  const listed = rows.map((row) => row.id).filter((id) => isIndexed(db, library, id));
  return skeletonOf(db, library, rows, listed);
}

/**
 * The folders at `folderIds` of `library`, whose tiles changed, as `folderSkeleton` has them, and
 * the library's folder's tile, `.` among them or not.
 */
export function folderTiles(
  db: CatalogDatabase,
  library: number,
  folderIds: string[],
): FolderSkeleton {
  const rows = foldersAt(db, library, folderIds);
  const listed = rows.map((row) => row.id).filter((id) => isIndexed(db, library, id));
  return skeletonOf(db, library, rows, listed);
}

/**
 * The shape of the skeleton's JSON as this build sends it, kept with each skeleton stored, as
 * other builds that share the index may store theirs otherwise. Change it with `FolderSkeleton`.
 */
export const SKELETON_FORMAT = 1;

/**
 * Every folder of `library` as `folderSkeleton` has them, as JSON, if kept ready-made: it reads
 * in milliseconds, where reading the folders' rows and covers takes seconds from a cold disk,
 * and goes between threads as one string rather than many arrays. `null` if none is kept.
 */
export function keptSkeleton(db: CatalogDatabase, library: number): string | null {
  return storedSkeleton(db, library, SKELETON_FORMAT);
}

/** Every folder of `library` as `folderSkeleton` has them, as JSON: the one kept, or made now. */
export function skeletonText(db: CatalogDatabase, library: number): string {
  return keptSkeleton(db, library) ?? JSON.stringify(folderSkeleton(db, library));
}

/** Makes the skeleton of `library` ready-made, unless it is already. */
export function keepSkeleton(db: CatalogDatabase, library: number): void {
  if (!hasStoredSkeleton(db, library, SKELETON_FORMAT)) {
    storeSkeleton(db, library, SKELETON_FORMAT, JSON.stringify(folderSkeleton(db, library)));
  }
}
