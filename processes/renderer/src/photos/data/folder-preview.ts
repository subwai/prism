import type { ScanState } from '#photos/data/directory-scan';
import { arrangeEntries } from '#photos/data/entries';
import type { PhotoLibrary } from '#photos/data/library';
import { preload } from '#photos/data/preload';

/** The folder preview's tile edge, in pixels. */
export const PREVIEW_TILE = 130;

const ready = new WeakMap<PhotoLibrary, Map<string, Promise<ScanState>>>();

/** About as many tiles as the preview sheet, 72% of the window by 70%, shows at once. */
function screenful() {
  const columns = Math.ceil((globalThis.innerWidth * 0.72) / PREVIEW_TILE);
  return columns * Math.ceil((globalThis.innerHeight * 0.7) / PREVIEW_TILE);
}

/**
 * A folder's listing once the thumbnails a preview of it opens with have decoded, as the
 * gallery's loader waits for its own, so moving between folders shows each one whole rather
 * than empty tiles filling in. The same promise for each folder, for `use()`.
 */
export function readFolderPreview(library: PhotoLibrary, directoryId: string) {
  let folders = ready.get(library);
  if (!folders) {
    folders = new Map();
    ready.set(library, folders);
  }
  let read = folders.get(directoryId);
  if (!read) {
    read = (async () => {
      const scan = await library.directory(directoryId);
      const opening = arrangeEntries(scan.entries, '', 'name', false).slice(0, screenful());
      await preload(library, opening, new AbortController().signal);
      return scan;
    })();
    folders.set(directoryId, read);
  }
  return read;
}
