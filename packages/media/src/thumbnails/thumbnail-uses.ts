import type { ThumbnailCache } from '#thumbnails/cache';
import { recordThumbnail, touchThumbnail, transaction } from '#thumbnails/index-queries';

/**
 * When each thumbnail was last used, which pruning reads to keep the ones in use. Uses are
 * noted in memory and written to the index together, so showing a thumbnail never waits for it.
 */

// Uses are written to the index together, this long after the first of them.
const SAVE_AFTER_MS = 2000;

/** A thumbnail found or shown: its size, if it was looked at, and when. */
export interface Use {
  size: number | undefined;
  usedMs: number;
}

/** Writes the uses noted since it last ran to the index, in one transaction. */
export function saveUses(cache: ThumbnailCache) {
  clearTimeout(cache.saveTimer);
  cache.saveTimer = undefined;
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
    // Only the times of use are lost, so pruning may remove these thumbnails a little early.
    process.emitWarning(`Noting which thumbnails were used failed: ${String(error)}`);
  }
}

/**
 * Notes that thumbnail `key` was used, for pruning to keep it, with its `size` if it was looked
 * at. Nothing waits for the index: the uses are written to it together a moment later.
 */
export function markUsed(cache: ThumbnailCache, key: string, size?: number): void {
  cache.used.set(key, { size: size ?? cache.used.get(key)?.size, usedMs: Date.now() });
  cache.saveTimer ??= setTimeout(() => saveUses(cache), SAVE_AFTER_MS).unref();
}
