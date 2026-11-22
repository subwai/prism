import { WorkerBackend } from '#photos/worker/backend';
import type { PhotoLibrary } from '#photos/worker/library';
import type { FrameReader } from '@prism/media';
import type { ThumbnailResult } from '@prism/shared';

/**
 * The worker's backend for `library`, and a window that shows its entries. `show` sets what it
 * shows, and `nextThumbnailResult` resolves with the next result the worker sends for an entry's
 * thumbnail.
 */
export function openWindow(library: PhotoLibrary, cacheDirectory: string, frame?: FrameReader) {
  const listeners = new Set<(entryId: string, result: ThumbnailResult) => void>();
  const backend = new WorkerBackend(library, cacheDirectory, frame, (event) => {
    if (event.kind === 'thumbnail') {
      const { entryId, ...result } = event.thumbnail;
      for (const listener of listeners) {
        listener(entryId, result as ThumbnailResult);
      }
    }
  });
  function nextThumbnailResult(entryId: string): Promise<ThumbnailResult> {
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
    return backend.reportScreenContents({ foldersToRead: [], shown, views: [] });
  }
  /** Shows only `entryId`, afresh, and resolves with the result the worker sends for its thumbnail. */
  async function thumbnail(entryId: string) {
    await show([]);
    const result = nextThumbnailResult(entryId);
    await show([entryId]);
    return result;
  }
  return { backend, nextThumbnailResult, show, thumbnail };
}
