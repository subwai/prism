import { passesRatingFilter } from '#ratings';
import { expect, test } from 'vitest';

test('a rating filter lets through at least or at most its stars, or what has none', () => {
  expect(passesRatingFilter('min3', 3)).toBe(true);
  expect(passesRatingFilter('min3', 2)).toBe(false);
  expect(passesRatingFilter('max2', 2)).toBe(true);
  expect(passesRatingFilter('max2', 3)).toBe(false);
  // At most leaves out what has no rating; unrated lets through only that.
  expect(passesRatingFilter('max2')).toBe(false);
  expect(passesRatingFilter('unrated')).toBe(true);
  expect(passesRatingFilter('unrated', 1)).toBe(false);
});
