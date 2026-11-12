import type { Indexer } from '#photos/worker/indexer';
import type { Catalog } from '@prism/catalog';
import type { FolderSummary, PhotoEntry } from '@prism/shared';

// A folder without photos of its own opens this many folders inside it to find a cover.
const MAX_COVER_FOLDERS = 256;
// Folders read at once while looking for covers, as a network share answers many at once
// about as fast as one.
const READ_AHEAD = 16;

export interface InspectionSources {
  catalog: Catalog;
  indexer: Indexer;
}

/**
 * What `directoryId` holds, read into the catalog first if this session has not read it, and
 * covers from the shallowest folder inside it with photos or videos, so a folder of folders
 * still shows what it holds.
 */
export async function inspectFolder(
  sources: InspectionSources,
  directoryId: string,
): Promise<FolderSummary> {
  const { error } = await sources.indexer.list(directoryId);
  if (error !== null) {
    throw new Error(error);
  }
  const summary = await sources.catalog.call('summary', directoryId);
  if (summary.covers.length > 0 || !summary.hasSubfolders) {
    return summary;
  }
  return { ...summary, covers: await nestedCovers(sources, directoryId) };
}

/**
 * The covers of the first folder inside `directoryId`, breadth first and by name, that has
 * any. It opens at most `MAX_COVER_FOLDERS` folders: counting the folders it lists instead
 * would give up before opening any in a wide layer, such as a year of day folders. Folders
 * that cannot be read are passed over, as their siblings may still have covers.
 */
async function nestedCovers(
  { catalog, indexer }: InspectionSources,
  directoryId: string,
): Promise<PhotoEntry[]> {
  let layer = [directoryId];
  let opened = 0;
  while (layer.length > 0 && opened < MAX_COVER_FOLDERS) {
    const next = (await catalog.call('subfolders', layer)).slice(0, MAX_COVER_FOLDERS - opened);
    opened += next.length;
    for (let start = 0; start < next.length; start += READ_AHEAD) {
      const batch = next.slice(start, start + READ_AHEAD);
      await Promise.all(batch.map((folderId) => indexer.list(folderId)));
      const covers = await catalog.call('firstCovers', batch);
      if (covers.length > 0) {
        return covers;
      }
    }
    layer = next;
  }
  return [];
}
