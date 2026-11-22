import type { Indexer } from '#photos/worker/indexer/indexer';
import type { CurrentPriority } from '#photos/worker/scheduler/scheduler';
import type { Catalog } from '@prism/catalog';

// A folder without photos of its own opens this many folders inside it to find a cover.
const MAX_COVER_FOLDERS = 256;
// Folders read at once while looking for covers, as a network share answers many at once
// about as fast as one.
const READ_AHEAD = 16;

export interface TileSources {
  catalog: Catalog;
  indexer: Indexer;
  /** The priority of the folder reads. They carry on in the background once the tile leaves the screen. */
  priority: CurrentPriority;
}

/**
 * Reads into the catalog what the tile of `directoryId` shows, for a folder the window has on
 * screen. That is the folder itself, if this session has not read it. For a folder with no photos
 * of its own, it is also the folders inside it, until one has photos to use as covers. The
 * folder's row in the catalog then has the covers, and the window learns of them as of any other
 * change, so this returns nothing.
 */
export async function readTile(sources: TileSources, directoryId: string): Promise<void> {
  const { error } = await sources.indexer.readIntoCatalog(directoryId, sources.priority);
  const tile = error === null ? await sources.catalog.call('tile', directoryId) : null;
  if (tile && tile.covers.length === 0 && tile.hasSubfolders) {
    await readUntilCoversFound(sources, directoryId, { left: MAX_COVER_FOLDERS });
  }
}

/**
 * Reads the folders inside `folderId` until one has covers, and returns whether one did. The
 * catalog copies a subfolder's covers up to the folder as their rows are written.
 * - The order is the one the catalog uses to choose the subfolder whose covers a folder shows:
 *   by name, and each one as deep as it goes before the next.
 * - The folders of one level are read `READ_AHEAD` at a time, ahead of their turn.
 * - It opens at most `budget.left` folders, because a wide level of folders without photos, such
 *   as a year of day folders, could take long.
 * - Folders that cannot be read are skipped, because their siblings may still have covers.
 */
async function readUntilCoversFound(
  sources: TileSources,
  folderId: string,
  budget: { left: number },
): Promise<boolean> {
  const { catalog, indexer, priority } = sources;
  const subfolders = await catalog.call('subfolderIds', [folderId]);
  for (let start = 0; start < subfolders.length && budget.left > 0; start += READ_AHEAD) {
    const batch = subfolders.slice(start, start + Math.min(READ_AHEAD, budget.left));
    budget.left -= batch.length;
    await Promise.all(batch.map((id) => indexer.readIntoCatalog(id, priority)));
    for (const id of batch) {
      const tile = await catalog.call('tile', id);
      if (tile && tile.covers.length > 0) {
        return true;
      }
      if (tile?.hasSubfolders && (await readUntilCoversFound(sources, id, budget))) {
        return true;
      }
    }
  }
  return false;
}
