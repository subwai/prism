import { arrangeEntries, screenful } from '#data/entries';
import type { PhotoLibrary } from '#data/library';
import { preload } from '#data/preload';
import { queryOptions } from '@tanstack/react-query';

/** The folder preview's tile edge, in pixels. */
export const PREVIEW_TILE = 130;

/**
 * Settles once the thumbnails a preview of the folder opens with have decoded, as the
 * gallery's loader waits for its own, so moving between folders shows each one whole rather
 * than empty tiles filling in.
 */
export function folderPreviewQuery(library: PhotoLibrary, directoryId: string) {
  return queryOptions({
    queryFn: async () => {
      const scan = await library.directory(directoryId);
      // The preview sheet is 72% of the window by 70%.
      const opening = arrangeEntries(scan.entries, '', 'name', false).slice(
        0,
        screenful(PREVIEW_TILE, { height: 0.7, width: 0.72 }),
      );
      await preload(library, opening, new AbortController().signal);
      return true;
    },
    queryKey: ['preview', directoryId],
  });
}
