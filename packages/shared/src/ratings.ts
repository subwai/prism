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

/**
 * What a view's rating filter can let through, each by its search parameter's value: `min3`
 * for three stars or more, `max2` for at most two, which leaves out what has no rating, and
 * `unrated` for that. Most stars first, as the search field offers them.
 */
export const RATING_FILTERS = [
  'min5',
  'min4',
  'min3',
  'min2',
  'min1',
  'max4',
  'max3',
  'max2',
  'max1',
  'unrated',
] as const;
export type RatingFilter = (typeof RATING_FILTERS)[number];

/** Whether `value` is one of `RATING_FILTERS`. */
export function isRatingFilter(value: unknown): value is RatingFilter {
  return RATING_FILTERS.some((filter) => filter === value);
}

/** Whether the rating filter `filter` lets through an entry rated `rating`, if at all. */
export function passesRatingFilter(filter: RatingFilter, rating?: Rating): boolean {
  if (filter === 'unrated') {
    return rating === undefined;
  }
  if (rating === undefined) {
    return false;
  }
  const stars = Number(filter.slice(3));
  return filter.startsWith('min') ? rating >= stars : rating <= stars;
}
