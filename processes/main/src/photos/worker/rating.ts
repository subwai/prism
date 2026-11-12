import { requireRating, requireString } from '#photos/validate';
import type { PhotoLibrary } from '#photos/worker/library';
import { identityOf } from '@prism/catalog';
import {
  carryThumbnail,
  readExif,
  type ThumbnailCache,
  thumbnailKey,
  writeRating,
} from '@prism/media';
import { errorMessage, type PhotoEntry, ratesInFile, type Rating } from '@prism/shared';
import { stat } from 'node:fs/promises';
import path from 'node:path';

const NO_PERMISSION = 'You don’t have permission to change it.';
const GONE = 'It no longer exists.';

// What the window says when the system refuses to rewrite a photo, rather than the raw error.
const FAILURES: Partial<Record<string, string>> = {
  EACCES: NO_PERMISSION,
  EBUSY: 'It is in use. Close it in other apps and try again.',
  ENOENT: GONE,
  EPERM: NO_PERMISSION,
  EROFS: 'It is on a disk that can’t be changed.',
};

/**
 * Ratings under way, by entry: a rating waits for the one before it of the same entry, so two
 * quick ones never rewrite a file at once and the last one chosen is the one it keeps. A worker
 * serves one library, so this is the module's.
 */
const pending = new Map<string, Promise<unknown>>();

/** `entry` rated `stars`, or with `null` unrated. */
function rated(entry: PhotoEntry, stars: Rating | null): PhotoEntry {
  const { rating: _old, ...rest } = entry;
  return stars === null ? rest : { ...rest, rating: stars };
}

/** Writes `stars` into the photo at `file`, saying why in words if the system refuses. */
async function rewrite(file: string, stars: Rating | null) {
  try {
    await writeRating(file, stars);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? '';
    throw new Error(FAILURES[code] ?? `It could not be rated: ${errorMessage(error)}`, {
      cause: error,
    });
  }
}

/**
 * Rates the photo `entry` in its own file. Its pixels stay as they were, so its thumbnail
 * carries over to the file as rewritten, and the library notes the rewrite as seen.
 */
async function ratePhoto(
  library: PhotoLibrary,
  cache: ThumbnailCache,
  entry: PhotoEntry,
  stars: Rating | null,
): Promise<PhotoEntry> {
  const file = await library.resolve(entry.id);
  const before = await stat(file);
  await rewrite(file, stars);
  const after = await stat(file);
  const exif = await readExif(file);
  await carryThumbnail(
    cache,
    thumbnailKey({ file, info: before }, false),
    thumbnailKey({ file, info: after }, false),
  ).catch(() => null);
  const now = (await library.entryAt(entry.id, entry.parentId)) ?? entry;
  library.storeRewrite(now, after, {
    exif,
    file,
    id: entry.id,
    identity: identityOf(after),
    modifiedMs: after.mtimeMs,
    size: after.size,
  });
  return { ...rated(now, exif.rating ?? null), exif };
}

async function rate(
  library: PhotoLibrary,
  cache: ThumbnailCache,
  entryId: string,
  stars: Rating | null,
): Promise<PhotoEntry> {
  const entry = await library.entryAt(entryId, path.dirname(entryId));
  if (!entry) {
    throw new Error(GONE);
  }
  if (ratesInFile(entry)) {
    return ratePhoto(library, cache, entry, stars);
  }
  await library.keepRating(entryId, stars);
  return rated(entry, stars);
}

/**
 * Rates an entry of `library`, or with `null` takes its rating away: a photo's is written
 * into its file, and anything else's, such as a folder's or a video's, kept in the ratings
 * file. Resolves with the entry as rated, which the window shows at once.
 */
export function rateEntry(
  library: PhotoLibrary,
  cache: ThumbnailCache,
  entryId: string,
  stars: Rating | null,
): Promise<PhotoEntry> {
  requireString(entryId);
  requireRating(stars);
  if (path.normalize(entryId) === '.') {
    return Promise.reject(new Error('The open folder can’t be rated here.'));
  }
  const previous = pending.get(entryId) ?? Promise.resolve();
  const next = previous.catch(() => null).then(() => rate(library, cache, entryId, stars));
  pending.set(entryId, next);
  next
    .finally(() => {
      if (pending.get(entryId) === next) {
        pending.delete(entryId);
      }
    })
    .catch(() => null);
  return next;
}
