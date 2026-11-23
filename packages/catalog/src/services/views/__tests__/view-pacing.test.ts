import { filtered, spec } from '#__tests__/fixtures';
import { readsDetails, refreshGap } from '#services/views/view-pacing';
import { expect, test } from 'vitest';

test("views read photos' details to sort by date taken, filter by them, or search their tags", () => {
  const photos = filtered({ format: ['Photo'] });
  const byCamera = filtered({ camera: ['Canon EOS R5'] });
  const byRating = filtered({ rating: ['min3'] });
  expect(readsDetails(spec())).toBe(false);
  expect(readsDetails(spec({ sort: 'modified' }))).toBe(false);
  expect(readsDetails(spec(photos))).toBe(false);
  expect(readsDetails(spec({ search: '  ' }))).toBe(false);

  expect(readsDetails(spec({ sort: 'taken' }))).toBe(true);
  expect(readsDetails(spec(byCamera))).toBe(true);
  expect(readsDetails(spec(byRating))).toBe(true);
  expect(readsDetails(spec({ search: 'beach' }))).toBe(true);
});

test('views are made again soon after rows change, and later the longer they take after details', () => {
  expect(refreshGap(10, false)).toBe(500);
  expect(refreshGap(600, false)).toBe(1200);

  expect(refreshGap(10, true)).toBe(500);
  expect(refreshGap(600, true)).toBe(4800);
  expect(refreshGap(10_000, true)).toBe(30_000);
});
