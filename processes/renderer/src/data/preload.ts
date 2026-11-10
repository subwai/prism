import type { LibrarySession } from '#data/library';
import { cachedThumbnailURL, type PhotoEntry } from '@prism/shared';

/**
 * How long a view waits for the thumbnails it opens with. Most are cached and arrive well
 * within it; past it, the view shows and the rest fill in, rather than holding up the click.
 */
const BUDGET_MS = 250;

async function decode(url: string) {
  const image = new Image();
  image.src = url;
  await image.decode();
}

/** Decodes `entry`'s thumbnail, the cached one or else one made now; whether it has one. */
async function decodeThumbnail(library: LibrarySession, entry: PhotoEntry) {
  const cached = cachedThumbnailURL(library.root.session, entry, library.media.getGeneration());
  const decoded = await decode(cached).then(
    () => true,
    () => false,
  );
  if (decoded) {
    return true;
  }
  const result = await library.thumbnail(entry.id);
  if (result.status !== 'ready') {
    return false;
  }
  // Cached now, and shown by the URL that found it missing, which is the one decoded.
  await decode(cached);
  return true;
}

/**
 * Loads and decodes the thumbnails a view opens with, so it can paint them on its first
 * frame. They stay wanted until they arrive, unless the navigation is abandoned.
 */
export async function preload(library: LibrarySession, entries: PhotoEntry[], signal: AbortSignal) {
  const releases: (() => void)[] = [];
  let released = false;
  const want = (id: string) => {
    if (!released) {
      releases.push(library.want(id));
    }
  };
  const release = () => {
    released = true;
    for (const done of releases.splice(0)) {
      done();
    }
  };
  signal.addEventListener('abort', release, { once: true });
  for (const entry of entries) {
    want(entry.id);
  }
  const loads = Promise.allSettled(
    entries.map(async (entry) => {
      if (entry.kind !== 'directory') {
        await decodeThumbnail(library, entry);
        return;
      }
      // The first cover with a thumbnail, as the folder's tile will show.
      for (const cover of (await library.summary(entry.id))?.covers ?? []) {
        want(cover.id);
        if (await decodeThumbnail(library, cover)) {
          return;
        }
      }
    }),
  ).finally(release);
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
