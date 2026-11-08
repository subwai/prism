import { narrows, needsExif, photoFilter } from '#data/filters';
import { expect, test } from 'vitest';

const filterOf = (search: string) => photoFilter(new URLSearchParams(search));

test('filters come from the URL, each field from its repeated parameter', () => {
  expect(filterOf('camera=Canon&tag=Beach&tag=Family')).toEqual({
    camera: ['Canon'],
    format: [],
    lens: [],
    tag: ['Beach', 'Family'],
  });
  expect(narrows(filterOf('sort=size'))).toBe(false);
  expect(narrows(filterOf('lens=RF'))).toBe(true);
});

test('only filters by what EXIF says need photos’ details', () => {
  expect(needsExif(filterOf('camera=Canon'))).toBe(true);
  // Whether an entry is a photo or a video needs no details read.
  expect(needsExif(filterOf('format=Video'))).toBe(false);
});
