import { nearestFirst } from '#photos/worker/on-screen/nearest-first';
import { expect, test } from 'vitest';

test('thumbnails ahead of the scroll go outward from the rows on show, the next row first', () => {
  expect(nearestFirst(10, 4, 6)).toEqual([4, 5, 6, 3, 7, 2, 8, 1, 9, 0]);
  expect(nearestFirst(5, 0, 2)).toEqual([0, 1, 2, 3, 4]);
  expect(nearestFirst(5, 3, 5)).toEqual([3, 4, 2, 1, 0]);
  // Rows on show past the end, as the view shrank, start from its end.
  expect(nearestFirst(3, 5, 9)).toEqual([2, 1, 0]);
  expect(nearestFirst(0, 0, 4)).toEqual([]);
});
