import { KIND_CODES } from '#data/codes';
import type { CatalogDatabase } from '#data/database';
import { summaryAt } from '#data/folder-summaries';
import { folderNumber, holdsFolder, moveFolders } from '#data/folders';
import { moveIndexed, unmarkIndexedInside } from '#data/indexed-folders';
import { foldersInside, itemOf, moveItem } from '#data/items';
import { placeOf } from '#data/scope';
import { type Touched, writeTouching, type Written } from '#writes';
import path from 'node:path';

/**
 * Moves the entry at `from` to `to`, and everything inside it, without reading anything again:
 * its row and those of the folders inside it take their new paths, and every entry keeps its
 * number, and with it its details, tags and place in covers. Returns `false`, changing nothing,
 * if the catalog has no entry at `from`, or has something at `to` already, or `to` is inside
 * `from`.
 */
function move(db: CatalogDatabase, library: number, from: string, to: string, touched: Touched) {
  if (
    to.startsWith(`${from}${path.sep}`) ||
    itemOf(db, library, from) === undefined ||
    itemOf(db, library, to) !== undefined ||
    holdsFolder(db, library, to)
  ) {
    return false;
  }
  const { parentId, name } = placeOf(to);
  const moved = moveItem(db, library, from, folderNumber(db, library, parentId), name);
  if (!moved) {
    return false;
  }
  touched.folders.add(path.dirname(from));
  touched.folders.add(parentId);
  // Covers show their entries' IDs, so the tiles showing this one, or the covers of a folder,
  // show otherwise, as far up as they pass.
  touched.rewritten.add(moved.item);
  if (moved.kind === KIND_CODES.directory) {
    moveFolders(db, library, from, to);
    unmarkIndexedInside(db, library, to);
    moveIndexed(db, library, from, to);
    for (const item of summaryAt(db, library, to)?.summary?.covers ?? []) {
      touched.rewritten.add(item);
    }
    // The tree reads again the subfolders of every folder whose ID changed.
    for (const id of [path.dirname(from), parentId, to, ...foldersInside(db, library, to)]) {
      touched.subfolders.add(id);
    }
  }
  return true;
}

/**
 * Moves the entry at `from` to `to` in one transaction, as the app moved it on disk; see `move`.
 * Returns what it wrote, or `null` if the catalog cannot, which then learns of it otherwise.
 */
export function moveInCatalog(
  db: CatalogDatabase,
  library: number,
  from: string,
  to: string,
): Written | null {
  let moved = false;
  const written = writeTouching(db, library, (touched) => {
    moved = move(db, library, from, to, touched);
  });
  return moved ? written : null;
}
