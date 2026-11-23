import type { CatalogDatabase } from '#database/catalog-database';
import { folderNumber, foldersInside, holdsFolder, moveFolders } from '#repositories/folders';
import { moveIndexed, unmarkIndexedInside } from '#repositories/indexed-folders';
import { itemOf, moveItem } from '#repositories/items/entries';
import { summaryAt } from '#repositories/items/folder-summaries';
import { KIND_CODES } from '#repositories/queries/codes';
import { placeOf } from '#repositories/queries/entry-ids';
import { commitWrite, noEffects, type WriteEffects } from '#writes/commit-write';
import type { WriteResult } from '#writes/write-result';
import path from 'node:path';

/**
 * Moves the entry at `from` to `to`, and everything inside it, without reading anything again:
 * its row and those of the folders inside it take their new paths, and every entry keeps its
 * number, and with it its details, tags and place in covers. It changes nothing if the catalog
 * has no entry at `from`, or has something at `to` already, or `to` is inside `from`.
 */
function move(
  db: CatalogDatabase,
  library: number,
  from: string,
  to: string,
  effects: WriteEffects,
): void {
  if (
    to.startsWith(`${from}${path.sep}`) ||
    itemOf(db, library, from) === undefined ||
    itemOf(db, library, to) !== undefined ||
    holdsFolder(db, library, to)
  ) {
    return;
  }
  const { parentId, name } = placeOf(to);
  const moved = moveItem(db, library, from, folderNumber(db, library, parentId), name);
  if (!moved) {
    return;
  }
  effects.folders.add(path.dirname(from));
  effects.folders.add(parentId);
  // Covers show their entries' IDs, so the tiles showing this one, or the covers of a folder,
  // show otherwise, as far up as they pass.
  effects.rewritten.add(moved.item);
  if (moved.kind === KIND_CODES.directory) {
    moveFolders(db, library, from, to);
    unmarkIndexedInside(db, library, to);
    moveIndexed(db, library, from, to);
    for (const item of summaryAt(db, library, to)?.summary?.covers ?? []) {
      effects.rewritten.add(item);
    }
    // The tree reads again the subfolders of every folder whose ID changed.
    for (const id of [path.dirname(from), parentId, to, ...foldersInside(db, library, to)]) {
      effects.subfolders.add(id);
    }
  }
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
): WriteResult | null {
  const result = commitWrite(db, library, () => {
    const effects = noEffects();
    move(db, library, from, to, effects);
    return { changedSinceRead: [], effects, newlyUnread: [], onlyDetails: false, toRead: [] };
  });
  // A move the catalog can't make stops before it changes a row, and one it makes always does.
  return result.changed ? result : null;
}
