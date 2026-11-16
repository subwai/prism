import { parentKey } from '#data/codes';
import { type CatalogDatabase, preparedOnce } from '#data/database';
import { folderAndInside, inside } from '#data/scope';
import { folders } from '#index-schema';
import { and, eq, gte, lt, sql } from 'drizzle-orm';

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

/** Whether the catalog keeps a folder at `folderId` or inside it, with a row or without. */
export function holdsFolder(db: CatalogDatabase, library: number, folderId: string): boolean {
  const row = db.get<{ found: number }>(
    sql`SELECT EXISTS ${folderAndInside(library, folderId)} AS found`,
  );
  return row?.found === 1;
}

/**
 * Moves the folder at `from`, and every folder inside it, to `to`, as it was renamed or moved:
 * each one's path and key start with `to`'s in place of `from`'s, and each keeps its number, so
 * the entries kept by it stay as they are. Two statements, as SQLite would scan every folder
 * rather than search for either of two.
 */
export function moveFolders(db: CatalogDatabase, library: number, from: string, to: string): void {
  const fromKey = parentKey(from);
  const moved = {
    key: sql`${parentKey(to)} || substr(${folders.key}, length(${fromKey}) + 1)`,
    path: sql`${to} || substr(${folders.path}, length(${from}) + 1)`,
  };
  const { start, end } = inside(from);
  db.update(folders)
    .set(moved)
    .where(and(eq(folders.library, library), eq(folders.path, from)))
    .run();
  db.update(folders)
    .set(moved)
    .where(and(eq(folders.library, library), gte(folders.path, start), lt(folders.path, end)))
    .run();
}
