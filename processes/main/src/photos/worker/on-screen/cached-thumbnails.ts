import type { PhotoLibrary } from '#photos/worker/library/library';
import {
  generateThumbnail,
  hasThumbnail,
  listedThumbnailKey,
  mediaKind,
  type ThumbnailCache,
  thumbnailKey,
} from '@prism/media';
import type { ThumbnailResult } from '@prism/shared';

/** The answer for a thumbnail cached under `key`, which the `media:` protocol serves. */
export function readyThumbnail(key: string): ThumbnailResult {
  return { status: 'ready', url: `media://thumbnail/${key}.webp` };
}

/**
 * The key of the entry's thumbnail if it is cached, named from what the catalog has of the
 * file where it has one, so that showing a cached thumbnail asks nothing of the disk the
 * photo is on: on a network share busy with reads, each such call took long enough to see.
 */
export async function findCachedThumbnail(
  library: PhotoLibrary,
  cache: ThumbnailCache,
  entryId: string,
): Promise<string | null> {
  const video = mediaKind(entryId) === 'video';
  const listed = await library.listedFile(entryId);
  const key = listed
    ? listedThumbnailKey(listed, video)
    : thumbnailKey(await library.openMediaFile(entryId), video);
  return (await hasThumbnail(cache, key)) ? key : null;
}

/**
 * Makes the thumbnail of the video `entryId` from `image`, a still the window took of it, for
 * a video the system can't take a still of.
 */
export async function storeVideoStill(
  library: PhotoLibrary,
  cache: ThumbnailCache,
  { entryId, image }: { entryId: string; image: Uint8Array },
): Promise<ThumbnailResult> {
  const source = await library.openMediaFile(entryId);
  if (mediaKind(source.file) !== 'video') {
    throw new Error('Only videos take their thumbnail from the window.');
  }
  const key = thumbnailKey(source, true);
  await generateThumbnail(cache, {
    frame: () => Promise.resolve(image),
    key,
    signal: library.signal,
    source,
  });
  return readyThumbnail(key);
}
