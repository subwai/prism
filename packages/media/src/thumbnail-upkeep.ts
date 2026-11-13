import { moveIntoSubfolder, type ThumbnailCache } from '#thumbnail-cache';
import {
  type IndexedThumbnail,
  isRebuilt,
  markRebuilt,
  recordFound,
  transaction,
} from '#thumbnail-index';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const THUMBNAIL_NAME = /^(?<key>[a-f\d]{64})\.webp$/u;
const SUBFOLDER_NAME = /^[a-f\d]{2}$/u;
// Found thumbnails are written to the index this many at a time.
const BATCH = 500;

/** Notes `found` in the index, keeping what it has already, and empties it. */
function record(cache: ThumbnailCache, found: IndexedThumbnail[]) {
  transaction(cache.index, () => {
    for (const thumbnail of found) {
      recordFound(cache.index, thumbnail);
    }
  });
  found.length = 0;
}

/** The thumbnails in the subfolder `name`, with their sizes, and their file times as their use. */
async function thumbnailsIn(cache: ThumbnailCache, name: string): Promise<IndexedThumbnail[]> {
  const found: IndexedThumbnail[] = [];
  const subfolder = path.join(cache.directory, name);
  // One stat at a time keeps the work from flooding the filesystem pool thumbnails wait on.
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
  const found: IndexedThumbnail[] = [];
  for (const name of await readdir(cache.directory).catch(() => [])) {
    const key = THUMBNAIL_NAME.exec(name)?.groups?.key;
    const info = key && (await stat(path.join(cache.directory, name)).catch(() => null));
    if (key && info && (await moveIntoSubfolder(cache.directory, key)) !== undefined) {
      found.push({ key, size: info.size, usedMs: Math.round(info.mtimeMs) });
    } else if (!rebuilt && SUBFOLDER_NAME.test(name)) {
      found.push(...(await thumbnailsIn(cache, name)));
    }
    if (found.length >= BATCH) {
      record(cache, found);
    }
  }
  record(cache, found);
  if (!rebuilt) {
    markRebuilt(cache.index, Date.now());
  }
  cache.flat = false;
}
