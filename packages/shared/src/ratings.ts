import type { PhotoEntry } from '#photos';

/** The stars an entry can be rated, from one to five. */
export const RATINGS = [1, 2, 3, 4, 5] as const;
export type Rating = (typeof RATINGS)[number];

/** Whether `value` is a rating: a whole number of stars from one to five. */
export function isRating(value: unknown): value is Rating {
  return RATINGS.some((rating) => rating === value);
}

/**
 * Returns the rating an entry rated `current` gets when the user picks `chosen`. Picking the
 * rating it already has removes it, which gives `null`.
 */
export function toggleRating(current: Rating | undefined, chosen: Rating): Rating | null {
  return current === chosen ? null : chosen;
}

/**
 * Whether `entry` keeps its rating in its own file, as XMP's `xmp:Rating`, which Lightroom,
 * Bridge and Windows Explorer read too. Photos do. Folders have no file to keep it in, and
 * videos keep theirs in the app, along with everything else.
 */
export function keepsRatingInFile(entry: Pick<PhotoEntry, 'kind'>): boolean {
  return entry.kind === 'image';
}

/**
 * The choices of a view's rating filter, each as its search parameter's value: `min3` lets
 * through three stars or more, `max2` at most two stars (but not entries with no rating), and
 * `unrated` only entries with no rating. Most stars first, in the order the search field
 * offers them.
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

/** Whether the rating filter `filter` lets through an entry rated `rating`, or not rated at all. */
export function passesRatingFilter(filter: RatingFilter, rating?: Rating): boolean {
  if (filter === 'unrated') {
    return rating === undefined;
  }
  if (rating === undefined) {
    return false;
  }
  // The other filters are `min` or `max` followed by a number of stars, such as `min3`.
  const stars = Number(filter.slice('min'.length));
  return filter.startsWith('min') ? rating >= stars : rating <= stars;
}
