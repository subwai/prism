import { contentsOf, mediaIn } from '#data/contents';
import type { CatalogDatabase } from '#data/database';
import { entries } from '#data/items';
import type { FolderSummary, PhotoEntry } from '@prism/shared';

// Enough to get past a few files that turn out to have no picture.
const MAX_COVERS = 4;

/**
 * What the catalog holds directly inside `folderId`, and the photos and videos to show as its
 * cover: photos first, as they always have a picture to show.
 */
export function summaryOf(db: CatalogDatabase, library: number, folderId: string): FolderSummary {
  const covers = entries(db, mediaIn(db, library, folderId, MAX_COVERS));
  return { ...contentsOf(db, library, folderId), covers };
}

/** The covers of the first of `folderIds` that has any. */
export function firstCovers(
  db: CatalogDatabase,
  library: number,
  folderIds: string[],
): PhotoEntry[] {
  for (const folderId of folderIds) {
    const covers = mediaIn(db, library, folderId, MAX_COVERS);
    if (covers.length > 0) {
      return entries(db, covers);
    }
  }
  return [];
}
