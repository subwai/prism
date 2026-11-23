import { moveIntoSubfolder, type ThumbnailCache } from '#thumbnails/cache';
import {
  type IndexedThumbnail,
  isRebuilt,
  markRebuilt,
  recordFound,
  transaction,
} from '#thumbnails/index-queries';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

// `stat` reads what the disk records of a file: its size, its times and its number on the disk.

const THUMBNAIL_NAME = /^(?<key>[a-f\d]{64})\.webp$/u;
const SUBFOLDER_NAME = /^[a-f\d]{2}$/u;
// Found thumbnails are written to the index this many at a time.
const RECORD_BATCH = 500;

/** Notes `found` in the index, keeping what it has already. */
function recordBatch(cache: ThumbnailCache, found: IndexedThumbnail[]) {
  transaction(cache.index, () => {
    for (const thumbnail of found) {
      recordFound(cache.index, thumbnail);
    }
  });
}

/** The thumbnails in the subfolder `name`, with their sizes, and their file times as their use. */
async function thumbnailsIn(cache: ThumbnailCache, name: string): Promise<IndexedThumbnail[]> {
  const found: IndexedThumbnail[] = [];
  const subfolder = path.join(cache.directory, name);
  // One `stat` at a time, so this background work never fills the thread pool that thumbnail
  // requests wait on.
  for (const file of await readdir(subfolder).catch(() => [])) {
    const key = THUMBNAIL_NAME.exec(file)?.groups?.key;
    const info = key && (await stat(path.join(subfolder, file)).catch(() => null));
    if (key && info) {
      found.push({ key, size: info.size, usedMs: Math.round(info.mtimeMs) });
    }
  }
  return found;
}

/**
 * Brings the cache folder and its index up to date, in the background, once a launch: moves
 * the thumbnails earlier versions kept in the folder itself into their subfolders, and, if the
 * index has never been made from the folder, as when its file was lost, makes it. Thumbnails
 * are shown meanwhile: `hasThumbnail` looks in the folder itself too until this is done, and
 * moves what it finds there. A thumbnail's file time stands for its last use, as it did before
 * the index, so the order pruning takes them in carries over.
 */
export async function upkeepThumbnailCache(cache: ThumbnailCache): Promise<void> {
  const rebuilt = isRebuilt(cache.index);
  let batch: IndexedThumbnail[] = [];
  for (const name of await readdir(cache.directory).catch(() => [])) {
    const key = THUMBNAIL_NAME.exec(name)?.groups?.key;
    const info = key && (await stat(path.join(cache.directory, name)).catch(() => null));
    if (key && info && (await moveIntoSubfolder(cache.directory, key)) !== undefined) {
      batch.push({ key, size: info.size, usedMs: Math.round(info.mtimeMs) });
    } else if (!rebuilt && SUBFOLDER_NAME.test(name)) {
      batch.push(...(await thumbnailsIn(cache, name)));
    }
    if (batch.length >= RECORD_BATCH) {
      recordBatch(cache, batch);
      batch = [];
    }
  }
  recordBatch(cache, batch);
  if (!rebuilt) {
    markRebuilt(cache.index, Date.now());
  }
  cache.mayHaveTopLevelThumbnails = false;
}
