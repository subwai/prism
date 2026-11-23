import { nameKey, parentKey } from '#repositories/queries/codes';
import { expect, test } from 'vitest';

test('names sort as people read them', () => {
  const names = ['IMG_10.jpg', 'img_9.jpg', 'Élan.jpg', 'elan2.jpg', 'IMG_009b.jpg', 'b.jpg'];
  expect(names.toSorted((left, right) => (nameKey(left) < nameKey(right) ? -1 : 1))).toEqual([
    'b.jpg',
    'Élan.jpg',
    'elan2.jpg',
    'img_9.jpg',
    'IMG_009b.jpg',
    'IMG_10.jpg',
  ]);
});

test("folders' keys sort each folder before the folders inside it and those named after it", () => {
  const folders = ['a b', 'a/b', 'A', '.', 'a/b/c', 'a0'];
  expect(folders.toSorted((left, right) => (parentKey(left) < parentKey(right) ? -1 : 1))).toEqual([
    '.',
    'A',
    'a/b',
    'a/b/c',
    'a b',
    'a0',
  ]);
});
