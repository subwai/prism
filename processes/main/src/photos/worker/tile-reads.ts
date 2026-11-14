import type { Indexer } from '#photos/worker/indexer';
import type { Catalog } from '@prism/catalog';

// A folder without photos of its own opens this many folders inside it to find a cover.
const MAX_COVER_FOLDERS = 256;
// Folders read at once while looking for covers, as a network share answers many at once
// about as fast as one.
const READ_AHEAD = 16;

export interface TileSources {
  catalog: Catalog;
  indexer: Indexer;
}

/**
 * Reads into the catalog what the tile of `directoryId` shows, for a folder the window has on
 * show: the folder itself, if this session has not read it, and for one with no photos of its
 * own, the folders inside it until one has covers to lend it. Its row in the catalog then has
 * them, and the window hears of it as of any change, so nothing is answered.
 */
export async function readTile(sources: TileSources, directoryId: string): Promise<void> {
  const { error } = await sources.indexer.list(directoryId);
  const tile = error === null ? await sources.catalog.call('tile', directoryId) : null;
  if (tile && tile.covers.length === 0 && tile.hasSubfolders) {
    await readCovers(sources, directoryId, { left: MAX_COVER_FOLDERS });
  }
}

/**
 * Reads the folders inside `folderId` in the order the catalog chooses the one that lends a
 * folder its covers, by name and each as deep as it goes before the next, until one has covers,
 * which the catalog passes up as their rows are written; says whether one had. A layer's folders
 * are read `READ_AHEAD` at a time ahead of their turn. It opens at most `budget.left` folders, as
 * a wide layer of folders without photos, such as a year of day folders, could take long. Folders
 * that cannot be read are passed over, as their siblings may still have covers.
 */
async function readCovers(
  sources: TileSources,
  folderId: string,
  budget: { left: number },
): Promise<boolean> {
  const { catalog, indexer } = sources;
  const subfolders = await catalog.call('subfolders', [folderId]);
  for (let start = 0; start < subfolders.length && budget.left > 0; start += READ_AHEAD) {
    const batch = subfolders.slice(start, start + Math.min(READ_AHEAD, budget.left));
    budget.left -= batch.length;
    await Promise.all(batch.map((id) => indexer.list(id)));
    for (const id of batch) {
      const tile = await catalog.call('tile', id);
      if (tile && tile.covers.length > 0) {
        return true;
      }
      if (tile?.hasSubfolders && (await readCovers(sources, id, budget))) {
        return true;
      }
    }
  }
  return false;
}
