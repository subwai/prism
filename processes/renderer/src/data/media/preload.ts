import type { LibrarySession } from '#data/library';
import { decodeImage } from '#data/media/decode-image';
import { cachedThumbnailURL, type PhotoEntry } from '@prism/shared';

/**
 * How long a view waits for the cached thumbnails it opens with, which arrive well within it;
 * past it, the view shows and the rest fill in, rather than holding up the click.
 */
const BUDGET_MS = 250;

/**
 * Decodes `entry`'s cached thumbnail, and returns whether it has one. One not cached is not
 * waited for: the worker makes it once the view shows the entry, and it appears when sent.
 */
function decodeThumbnail(library: LibrarySession, entry: PhotoEntry) {
  const cached = cachedThumbnailURL(library.root.session, entry, library.media.getGeneration());
  return decodeImage(cached).then(
    () => true,
    () => false,
  );
}

/**
 * Loads and decodes the cached thumbnails a view opens with, so it can paint them on its first
 * frame.
 */
export async function preload(library: LibrarySession, entries: PhotoEntry[]) {
  const loads = Promise.allSettled(
    entries.map(async (entry) => {
      if (entry.kind !== 'directory') {
        await decodeThumbnail(library, entry);
        return;
      }
      // The first cover with a thumbnail, as the folder's tile will show.
      for (const cover of entry.summary?.covers ?? []) {
        if (await decodeThumbnail(library, cover)) {
          return;
        }
      }
    }),
  );
  await withinBudget(loads);
}

/** Waits for `work`, but no longer than the budget. */
function withinBudget(work: Promise<unknown>) {
  return Promise.race([
    work,
    new Promise((resolve) => {
      setTimeout(resolve, BUDGET_MS);
    }),
  ]);
}

/**
 * Loads and decodes the photos the reader or the filmstrip opens on, so its first frame shows
 * them, in the reader at their own height, rather than placeholders that change as they arrive.
 */
export async function preloadPages(library: LibrarySession, pages: PhotoEntry[]) {
  // Marked as on screen until they arrive. By then the pages on screen have marked them too.
  const releases = pages.map((page) => library.markEntryOnScreen(page.id));
  const loads = Promise.allSettled(
    pages.map((page) => library.queries.fetchQuery(library.originalQuery(page))),
  ).finally(() => {
    for (const release of releases) {
      release();
    }
  });
  await withinBudget(loads);
}
