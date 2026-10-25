import type { PhotoLibrary } from '#photos/data/library';
import type { PhotoEntry, ThumbnailResult } from '@prism/shared';

/**
 * How long a view waits for the thumbnails it opens with. Most are cached and arrive well
 * within it; past it, the view shows and the rest fill in, rather than holding up the click.
 */
const BUDGET_MS = 250;

/**
 * Loads and decodes the thumbnails a view opens with, so it can paint them on its first
 * frame. They stay wanted until they arrive, unless the navigation is abandoned.
 */
export async function preload(library: PhotoLibrary, entries: PhotoEntry[], signal: AbortSignal) {
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
      let result: ThumbnailResult | null = null;
      if (entry.kind === 'directory') {
        // The first cover with a thumbnail, as the folder's tile will show.
        for (const cover of (await library.summary(entry.id))?.covers ?? []) {
          want(cover.id);
          result = await library.thumbnail(cover.id);
          if (result.status === 'ready') {
            break;
          }
        }
      } else {
        result = await library.thumbnail(entry.id);
      }
      if (result?.status === 'ready') {
        const image = new Image();
        image.src = result.url;
        await image.decode();
      }
    })
  ).finally(release);
  await Promise.race([
    loads,
    new Promise((resolve) => {
      setTimeout(resolve, BUDGET_MS);
    })
  ]);
}
