import type { PhotoEntry } from '#photos';

/** The stars an entry can be rated, from one to five. */
export const RATINGS = [1, 2, 3, 4, 5] as const;
export type Rating = (typeof RATINGS)[number];

/** Whether `value` is a rating: a whole number of stars from one to five. */
export function isRating(value: unknown): value is Rating {
  return RATINGS.some((rating) => rating === value);
}

/** The rating choosing `chosen` gives an entry rated `current`: choosing it again unrates it. */
export function nextRating(current: Rating | undefined, chosen: Rating): Rating | null {
  return current === chosen ? null : chosen;
}

/**
 * Whether `entry` keeps its rating in its own file, as XMP's `xmp:Rating`, which Lightroom,
 * Bridge and Windows Explorer read too. Photos do; folders have no file to keep it in, and
 * videos are left to the app's own ratings, which keep the rest.
 */
export function ratesInFile(entry: Pick<PhotoEntry, 'kind'>): boolean {
  return entry.kind === 'image';
}
