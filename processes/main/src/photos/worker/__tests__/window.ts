import { WorkerBackend } from '#photos/worker/backend';
import type { PhotoLibrary } from '#photos/worker/library';
import type { FrameReader } from '@prism/media';
import type { ThumbnailResult } from '@prism/shared';

/**
 * The worker's backend for `library`, and a window that shows its entries: `show` says what it
 * shows, and `told` resolves with what the worker next tells of an entry's thumbnail.
 */
export function openWindow(library: PhotoLibrary, cacheDirectory: string, frame?: FrameReader) {
  const listeners = new Set<(entryId: string, result: ThumbnailResult) => void>();
  const backend = new WorkerBackend(library, cacheDirectory, frame, (event) => {
    if ('thumbnail' in event) {
      const { entryId, ...result } = event.thumbnail;
      for (const listener of listeners) {
        listener(entryId, result as ThumbnailResult);
      }
    }
  });
  function told(entryId: string): Promise<ThumbnailResult> {
    return new Promise((resolve) => {
      const listener = (id: string, result: ThumbnailResult) => {
        if (id === entryId) {
          listeners.delete(listener);
          resolve(result);
        }
      };
      listeners.add(listener);
    });
  }
  function show(shown: string[]) {
    return backend.attend({ shown, tiles: [], views: [] });
  }
  /** Shows only `entryId`, afresh, and resolves with what the worker tells of its thumbnail. */
  async function thumbnail(entryId: string) {
    await show([]);
    const result = told(entryId);
    await show([entryId]);
    return result;
  }
  return { backend, show, thumbnail, told };
}
