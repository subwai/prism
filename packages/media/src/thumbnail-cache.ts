import {
  forgetAllThumbnails,
  forgetThumbnails,
  indexedBytes,
  type IndexedThumbnail,
  isRebuilt,
  leastRecentlyUsed,
  recordThumbnail,
  touchThumbnail,
  transaction,
} from '#thumbnail-index';
import { openThumbnailIndex, type ThumbnailIndex } from '#thumbnail-index-file';
import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';

// About 380,000 thumbnails of 13 KB.
const CACHE_BUDGET_BYTES = 5 * 1024 * 1024 * 1024;
// Pruning reads the index rather than the folder, so it can run after every 50 MB written.
const PRUNE_AFTER_BYTES = CACHE_BUDGET_BYTES / 100;
// Pruning forgets and removes this many thumbnails at a time, so no write waits long for the index.
const PRUNE_BATCH = 500;
const STALE_TEMPORARY_MS = 60_000;
// Uses are written to the index together, this long after the first of them.
const SAVE_AFTER_MS = 2000;

/** Whether `error` says a file or folder does not exist. */
function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

/** A thumbnail found or shown: its size, if it was looked at, and when. */
interface Use {
  size: number | undefined;
  usedMs: number;
}

/**
 * A folder of cached thumbnails, shared by every library and process, and its index: each
 * thumbnail's size and when it was last used, which pruning reads instead of the folder. The
 * folder holds a subfolder for each two hex digits a key can start with (`thumbnailFile`), so
 * none holds more than a few thousand files.
 */
export interface ThumbnailCache {
  readonly directory: string;
  /** The bytes pruning keeps the folder within. */
  readonly budget: number;
  readonly index: ThumbnailIndex;
  /** Thumbnails used since the index was last written to, by key. */
  readonly used: Map<string, Use>;
  saving: NodeJS.Timeout | undefined;
  /**
   * Whether thumbnails may still be in the folder itself, as versions before the subfolders
   * kept them, until `upkeepThumbnailCache` has moved them.
   */
  flat: boolean;
  /** What was written since the cache was last pruned. */
  written: number;
  pruning: Promise<void> | undefined;
}

/**
 * The thumbnails cached in `directory`, indexed in the file beside it of the same name with
 * `.db` added, outside the folder so deleting the folder leaves the connections to it working.
 */
export function thumbnailCache(directory: string, budget = CACHE_BUDGET_BYTES): ThumbnailCache {
  return {
    budget,
    directory,
    flat: true,
    index: openThumbnailIndex(`${directory}.db`),
    pruning: undefined,
    saving: undefined,
    used: new Map(),
    // The first write prunes, catching up with what earlier sessions wrote.
    written: PRUNE_AFTER_BYTES,
  };
}

/** Where thumbnail `key` is kept in `directory`: in the subfolder of its first two hex digits. */
export function thumbnailFile(directory: string, key: string): string {
  return path.join(directory, key.slice(0, 2), `${key}.webp`);
}

/** Where versions before the subfolders kept thumbnail `key`. */
export function flatThumbnailFile(directory: string, key: string): string {
  return path.join(directory, `${key}.webp`);
}

/** A file to write thumbnail `key` to before it is renamed into place. */
export function temporaryFile(cache: ThumbnailCache, key: string): string {
  // In the folder itself, so pruning finds those left behind without reading the subfolders.
  return path.join(cache.directory, `${key}.${randomUUID()}.tmp`);
}

/** Writes the uses noted since it last ran to the index, in one transaction. */
function saveUses(cache: ThumbnailCache) {
  clearTimeout(cache.saving);
  cache.saving = undefined;
  const uses = [...cache.used];
  cache.used.clear();
  if (uses.length === 0) {
    return;
  }
  try {
    transaction(cache.index, () => {
      for (const [key, { size, usedMs }] of uses) {
        // A thumbnail found in the folder that the index lacks is added; one only shown, whose
        // size is not known, is marked as used if the index has it.
        if (size === undefined) {
          touchThumbnail(cache.index, key, usedMs);
        } else {
          recordThumbnail(cache.index, { key, size, usedMs });
        }
      }
    });
  } catch (error) {
    // Only when they were used is lost, so pruning may take them a little early.
    process.emitWarning(`Noting which thumbnails were used failed: ${String(error)}`);
  }
}

/**
 * Notes that thumbnail `key` was used, for pruning to keep it, with its `size` if it was looked
 * at. Nothing waits for the index: the uses are written to it together a moment later.
 */
export function markUsed(cache: ThumbnailCache, key: string, size?: number): void {
  cache.used.set(key, { size: size ?? cache.used.get(key)?.size, usedMs: Date.now() });
  cache.saving ??= setTimeout(() => saveUses(cache), SAVE_AFTER_MS).unref();
}

/** Notes thumbnail `key` as just made, at once, so a session that ends next still counts it. */
function noteMade(cache: ThumbnailCache, key: string, size: number) {
  try {
    recordThumbnail(cache.index, { key, size, usedMs: Date.now() });
  } catch {
    // Another process held the index too long; it is written with the next uses instead.
    markUsed(cache, key, size);
  }
}

/** Moves thumbnail `key` from the folder itself into its subfolder; its size if it was there. */
export async function moveIntoSubfolder(
  directory: string,
  key: string,
): Promise<number | undefined> {
  const file = thumbnailFile(directory, key);
  try {
    const { size } = await stat(flatThumbnailFile(directory, key));
    await mkdir(path.dirname(file), { recursive: true });
    await rename(flatThumbnailFile(directory, key), file);
    return size;
  } catch (error) {
    // Moved meanwhile by another process, or removed.
    if (isMissing(error)) {
      return undefined;
    }
    throw error;
  }
}

/**
 * Whether thumbnail `key` is cached; marks it as used. One look at its file answers, and a
 * second where it may still be kept as earlier versions kept it, which moves it.
 */
export async function hasThumbnail(cache: ThumbnailCache, key: string): Promise<boolean> {
  try {
    const { size } = await stat(thumbnailFile(cache.directory, key));
    markUsed(cache, key, size);
    return true;
  } catch (error) {
    if (!isMissing(error)) {
      throw error;
    }
  }
  const moved = cache.flat ? await moveIntoSubfolder(cache.directory, key) : undefined;
  if (moved === undefined) {
    return false;
  }
  markUsed(cache, key, moved);
  return true;
}

/** Puts the file `temporary` in place as thumbnail `key`, and notes it in the index. */
export async function keepThumbnail(
  cache: ThumbnailCache,
  temporary: string,
  key: string,
  size: number,
): Promise<void> {
  const file = thumbnailFile(cache.directory, key);
  await mkdir(path.dirname(file), { recursive: true });
  await rename(temporary, file);
  noteMade(cache, key, size);
  wrote(cache, size);
}

/**
 * Keeps thumbnail `from` as `to` too, for a file rewritten without changing its pixels, as
 * writing a rating does. Nothing happens if `from` is not cached.
 */
export async function carryThumbnail(
  cache: ThumbnailCache,
  from: string,
  to: string,
): Promise<void> {
  if (from === to || !(await hasThumbnail(cache, from))) {
    return;
  }
  const temporary = temporaryFile(cache, to);
  try {
    await copyFile(thumbnailFile(cache.directory, from), temporary);
    await keepThumbnail(cache, temporary, to, (await stat(temporary)).size);
  } finally {
    await rm(temporary, { force: true });
  }
}

/** Removes the temporaries in the cache folder that no write has used for a while. */
async function removeStaleTemporaries(directory: string) {
  for (const name of await readdir(directory).catch(() => [])) {
    if (name.endsWith('.tmp')) {
      const file = path.join(directory, name);
      const info = await stat(file).catch(() => null);
      if (info && Date.now() - info.mtimeMs > STALE_TEMPORARY_MS) {
        await rm(file, { force: true });
      }
    }
  }
}

/**
 * Forgets the thumbnails used longest ago, up to a batch of them, that the cache must lose to
 * fit its budget, and returns them. Two processes pruning at once take turns, as each counts
 * the bytes and forgets in one transaction.
 */
function forgetOldest(cache: ThumbnailCache): IndexedThumbnail[] {
  const forgotten: IndexedThumbnail[] = [];
  transaction(cache.index, () => {
    let bytes = indexedBytes(cache.index);
    for (const thumbnail of leastRecentlyUsed(cache.index, PRUNE_BATCH)) {
      if (bytes <= cache.budget) {
        break;
      }
      forgotten.push(thumbnail);
      bytes -= thumbnail.size;
    }
    if (forgotten.length > 0) {
      forgetThumbnails(
        cache.index,
        forgotten.map((thumbnail) => thumbnail.key),
      );
    }
  });
  return forgotten;
}

/**
 * Removes the thumbnails used longest ago until the cache fits its budget, and stale
 * temporaries. The index says which, so no subfolder is read. A file someone else removed only
 * counts until it is pruned. Until the index has been made from the folder, it may lack many
 * thumbnails, so pruning waits for it.
 */
export async function pruneThumbnails(cache: ThumbnailCache): Promise<void> {
  await removeStaleTemporaries(cache.directory);
  if (!isRebuilt(cache.index)) {
    return;
  }
  saveUses(cache);
  for (let oldest = forgetOldest(cache); oldest.length > 0; oldest = forgetOldest(cache)) {
    for (const { key } of oldest) {
      await rm(thumbnailFile(cache.directory, key), { force: true });
    }
  }
}

/** Counts `bytes` written, pruning once enough are, one prune at a time. */
function wrote(cache: ThumbnailCache, bytes: number) {
  cache.written += bytes;
  if (cache.pruning || cache.written < PRUNE_AFTER_BYTES) {
    return;
  }
  cache.written = 0;
  cache.pruning = pruneThumbnails(cache)
    .catch((error: unknown) =>
      process.emitWarning(`Thumbnail cache cleanup failed: ${String(error)}`),
    )
    .finally(() => {
      cache.pruning = undefined;
    });
}

/** Forgets every thumbnail, for a cache folder deleted as a whole. */
export function forgetCachedThumbnails(cache: ThumbnailCache): void {
  cache.used.clear();
  forgetAllThumbnails(cache.index);
}
