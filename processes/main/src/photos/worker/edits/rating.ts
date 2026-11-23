import { requireRating, requireString } from '#photos/validate';
import { writeRatingIntoFile } from '#photos/worker/disk/rating-file';
import { ENTRY_GONE } from '#photos/worker/disk/refusal-messages';
import type { PhotoLibrary } from '#photos/worker/library/library';
import { carryThumbnail, readExif, type ThumbnailCache, thumbnailKey } from '@prism/media';
import {
  keepsRatingInFile,
  OneAfterAnotherPerKey,
  type PhotoEntry,
  type Rating,
} from '@prism/shared';
import path from 'node:path';

/** What a rating changes, and where. */
export interface RatingRequest {
  /** The library the entry is in. */
  library: PhotoLibrary;
  /** The thumbnail cache, where a photo's thumbnail carries over to its rewritten file. */
  cache: ThumbnailCache;
  entryId: string;
  /** The rating to give it, or `null` to take its rating away. */
  stars: Rating | null;
}

/**
 * Ratings under way, by entry: a rating waits for the one before it of the same entry, so two
 * quick ones never rewrite a file at once and the last one chosen is the one it keeps. A worker
 * serves one library, so this is the module's.
 */
const ratingsInTurn = new OneAfterAnotherPerKey<string>();

/** `entry` rated `stars`, or with `null` unrated. */
function withRating(entry: PhotoEntry, stars: Rating | null): PhotoEntry {
  const { rating: _old, ...rest } = entry;
  return stars === null ? rest : { ...rest, rating: stars };
}

/**
 * Rates the photo `entry` in its own file. Its pixels stay as they were, so its thumbnail
 * carries over to the file as rewritten, and the library notes the rewrite as seen.
 */
async function ratePhoto(
  { library, cache, stars }: RatingRequest,
  entry: PhotoEntry,
): Promise<PhotoEntry> {
  const file = await library.resolve(entry.id);
  const { before, after } = await writeRatingIntoFile(file, stars);
  const exif = await readExif(file);
  await carryThumbnail(
    cache,
    thumbnailKey({ file, info: before }, false),
    thumbnailKey({ file, info: after }, false),
  ).catch(() => null);
  const now = (await library.entryAt(entry.id, entry.parentId)) ?? entry;
  library.storeRewrite(now, after, {
    exif,
    id: entry.id,
    modifiedMs: after.mtimeMs,
    size: after.size,
  });
  return { ...withRating(now, exif.rating ?? null), exif };
}

async function applyRating(request: RatingRequest): Promise<PhotoEntry> {
  const { library, entryId, stars } = request;
  const entry = await library.entryAt(entryId, path.dirname(entryId));
  if (!entry) {
    throw new Error(ENTRY_GONE);
  }
  if (keepsRatingInFile(entry)) {
    return ratePhoto(request, entry);
  }
  await library.keepRating(entryId, stars);
  return withRating(entry, stars);
}

/**
 * Rates an entry of its library, or with `null` takes its rating away: a photo's is written
 * into its file, and anything else's, such as a folder's or a video's, kept in the ratings
 * file. Resolves with the entry as rated, which the window shows at once.
 */
export function rateEntry(request: RatingRequest): Promise<PhotoEntry> {
  const { entryId, stars } = request;
  requireString(entryId);
  requireRating(stars);
  if (path.normalize(entryId) === '.') {
    return Promise.reject(new Error('The open folder can’t be rated here.'));
  }
  return ratingsInTurn.run(entryId, () => applyRating(request));
}
