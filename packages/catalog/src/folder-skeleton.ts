import { everyFolder, type FolderRow, foldersIn } from '#data/contents';
import type { CatalogDatabase } from '#data/database';
import { indexedFolderIds, isIndexed } from '#data/indexed-folders';
import type { FolderSkeleton } from '@prism/shared';

function skeletonOf(rows: FolderRow[], listed: string[]): FolderSkeleton {
  return { folders: rows.map(({ id, parentId, name }) => [id, parentId, name]), listed };
}

/**
 * The folders of `library` the catalog knows, for the sidebar's tree: every one of them, or
 * those directly inside each of `parentIds`, with which of those folders were read to the end.
 */
export function folderSkeleton(
  db: CatalogDatabase,
  library: number,
  parentIds?: string[],
): FolderSkeleton {
  if (!parentIds) {
    return skeletonOf(everyFolder(db, library), indexedFolderIds(db, library));
  }
  return skeletonOf(
    parentIds.flatMap((id) => foldersIn(db, library, id)),
    parentIds.filter((id) => isIndexed(db, library, id)),
  );
}
