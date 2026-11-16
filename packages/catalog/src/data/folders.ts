import { parentKey } from '#data/codes';
import { type CatalogDatabase, preparedOnce } from '#data/database';
import { folders } from '#index-schema';
import { and, eq, sql } from 'drizzle-orm';

const atPlaceholderPath = and(
  eq(folders.library, sql.placeholder('library')),
  eq(folders.path, sql.placeholder('path')),
);

const folderQuery = preparedOnce((db) =>
  db.select({ folder: folders.folder }).from(folders).where(atPlaceholderPath).prepare(),
);

const addFolderQuery = preparedOnce((db) =>
  db
    .insert(folders)
    .values({
      key: sql.placeholder('key'),
      library: sql.placeholder('library'),
      path: sql.placeholder('path'),
    })
    .returning({ folder: folders.folder })
    .prepare(),
);

/**
 * The number of the folder at `folderId`, which entries in it are kept by, added without a row
 * if the catalog has none, as for the library's own folder, or one whose row is not in yet:
 * the triggers on `items` give it its row when that comes. A folder the catalog has is only
 * read, so listing what it has changes nothing.
 */
export function folderNumber(db: CatalogDatabase, library: number, folderId: string): number {
  const known = folderQuery(db).get({ library, path: folderId });
  if (known) {
    return known.folder;
  }
  const added = addFolderQuery(db).get({ key: parentKey(folderId), library, path: folderId });
  if (!added) {
    throw new Error('The catalog returned no row for a folder.');
  }
  return added.folder;
}
