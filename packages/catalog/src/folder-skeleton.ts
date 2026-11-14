import { everyFolder, type FolderRow, foldersIn } from '#data/contents';
import type { CatalogDatabase } from '#data/database';
import { coverFiles } from '#data/folder-summaries';
import { indexedFolderIds, isIndexed } from '#data/indexed-folders';
import type { FolderSkeleton, SkeletonCover, SkeletonTile } from '@prism/shared';

/**
 * The skeleton of `rows`, with which of them were `listed`. Each set of covers goes once, as a
 * folder that borrows them shares them with the folders they come from, and each cover as what
 * names its thumbnail. A folder whose tile the writer has yet to work out is sent as unknown,
 * rather than worked out here for every folder of the library; the writer tells of it once it
 * has.
 */
function skeletonOf(db: CatalogDatabase, rows: FolderRow[], listed: string[]): FolderSkeleton {
  const shown = new Set(rows.flatMap((row) => row.summary?.covers ?? []));
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
  const folders = rows.map(({ id, parentId, name, summary }) => {
    const tile: SkeletonTile = summary
      ? [summary.hasEntries, summary.hasSubfolders, setOf(summary.covers)]
      : null;
    return [id, parentId, name, tile] satisfies FolderSkeleton['folders'][number];
  });
  return { covers, folders, listed };
}

/**
 * The folders of `library` the catalog knows, for the sidebar's tree: every one of them, or
 * those directly inside each of `parentIds`, with which of those folders were read to the end,
 * and each folder's tile.
 */
export function folderSkeleton(
  db: CatalogDatabase,
  library: number,
  parentIds?: string[],
): FolderSkeleton {
  if (!parentIds) {
    return skeletonOf(db, everyFolder(db, library), indexedFolderIds(db, library));
  }
  return skeletonOf(
    db,
    parentIds.flatMap((id) => foldersIn(db, library, id)),
    parentIds.filter((id) => isIndexed(db, library, id)),
  );
}
