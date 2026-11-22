import type { LibrarySession } from '#data/library';
import { buildCachedThumbnailURL, type PhotoEntry } from '@prism/shared';

/**
 * How long a view waits for the cached thumbnails it opens with, which arrive well within it;
 * past it, the view shows and the rest fill in, rather than holding up the click.
 */
const BUDGET_MS = 250;

async function decode(url: string) {
  const image = new Image();
  image.src = url;
  await image.decode();
}

/**
 * Decodes `entry`'s cached thumbnail; whether it has one. One not cached is not waited for: the
 * worker makes it as the view shows it, and it appears once told of.
 */
function decodeThumbnail(library: LibrarySession, entry: PhotoEntry) {
  const cached = buildCachedThumbnailURL(
    library.root.session,
    entry,
    library.media.getGeneration(),
  );
  return decode(cached).then(
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
  // Wanted until they arrive; by then the pages on screen want them too.
  const releases = pages.map((page) => library.want(page.id));
  const loads = Promise.allSettled(
    pages.map((page) => library.queries.fetchQuery(library.originalQuery(page))),
  ).finally(() => {
    for (const release of releases) {
      release();
    }
  });
  await withinBudget(loads);
}
