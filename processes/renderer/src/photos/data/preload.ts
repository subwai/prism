import type { PhotoLibrary } from '#photos/data/library';
import type { PhotoEntry, ThumbnailResult } from '@app/shared';

/**
 * Loads and decodes the thumbnails a view opens with, so it can paint them on its first
 * frame. An aborted navigation stops holding them as wanted.
 */
export async function preload(library: PhotoLibrary, entries: PhotoEntry[], signal: AbortSignal) {
  const releases = entries.map((entry) => library.want(entry.id));
  const release = () => {
    for (const done of releases.splice(0)) {
      done();
    }
  };
  signal.addEventListener('abort', release, { once: true });
  await Promise.allSettled(
    entries.map(async (entry) => {
      let result: ThumbnailResult | null = null;
      if (entry.kind === 'directory') {
        // The first cover with a thumbnail, as the folder's tile will show.
        for (const cover of (await library.summary(entry.id))?.covers ?? []) {
          result = await library.thumbnail(cover.id, entry.id);
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
  );
  release();
}
