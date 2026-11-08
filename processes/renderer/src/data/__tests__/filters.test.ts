import { arrangeView } from '#data/entries';
import {
  filterChoices,
  type FilterField,
  matches,
  narrows,
  type PhotoFilter,
  photoFilter,
} from '#data/filters';
import { scanDetail } from '#data/urls';
import type { PhotoEntry, PhotoExif } from '@prism/shared';
import { expect, test } from 'vitest';

function shot(name: string, exif?: PhotoExif): PhotoEntry {
  return { exif, id: name, kind: 'image', name, parentId: '.' };
}

const entries: PhotoEntry[] = [
  shot('a.jpg', { camera: 'Canon EOS R5', lens: 'RF 50mm', tags: ['Beach', 'Family'] }),
  shot('b.jpg', { camera: 'FUJIFILM X-T5', tags: ['Beach'] }),
  shot('c.jpg', { camera: 'Canon EOS R5', lens: 'RF 24-70mm' }),
  shot('d.jpg'),
  { id: 'clip.mp4', kind: 'video', name: 'clip.mp4', parentId: '.' },
  { id: 'Trips', kind: 'directory', name: 'Trips', parentId: '.' },
];

const none: PhotoFilter = { camera: [], format: [], lens: [], tag: [] };

function narrowedBy(search: string) {
  return narrows(photoFilter(new URLSearchParams(search)));
}

test('filters come from the URL, each field from its repeated parameter', () => {
  expect(photoFilter(new URLSearchParams('camera=Canon&tag=Beach&tag=Family'))).toEqual({
    camera: ['Canon'],
    format: [],
    lens: [],
    tag: ['Beach', 'Family'],
  });
  expect(narrowedBy('sort=size')).toBe(false);
  expect(narrowedBy('lens=RF')).toBe(true);
});

test('suggesting or applying filters reads EXIF details, whatever the sort', () => {
  expect(scanDetail(new URLSearchParams('suggest=1'))).toEqual({ exif: true, metadata: true });
  expect(scanDetail(new URLSearchParams('camera=Canon&sort=size'))).toEqual({
    exif: true,
    metadata: true,
  });
  expect(scanDetail(new URLSearchParams('sort=size'))).toEqual({ exif: false, metadata: true });
  // Whether an entry is a photo or a video needs no details read.
  expect(scanDetail(new URLSearchParams('format=Video'))).toEqual({ exif: false, metadata: false });
});

test('a filter keeps the photos matching a value of every field it chooses', () => {
  const filter = { ...none, camera: ['Canon EOS R5'] };
  expect(entries.filter((entry) => matches(entry, filter)).map((entry) => entry.name)).toEqual([
    'a.jpg',
    'c.jpg',
  ]);
  expect(matches(entries[0] as PhotoEntry, { ...filter, lens: ['RF 24-70mm'] })).toBe(false);
  const view = (chosen: PhotoFilter | null) =>
    arrangeView(entries, 'grid', {
      descending: false,
      filter: chosen,
      search: '',
      sort: 'name',
    }).map((entry) => entry.name);
  expect(view({ ...none, lens: ['RF 24-70mm'] })).toEqual(['c.jpg']);
  expect(view({ ...none, tag: ['Beach'] })).toEqual(['a.jpg', 'b.jpg']);
  expect(view({ ...none, camera: ['Canon EOS R5'], tag: ['Beach'] })).toEqual(['a.jpg']);
  // Values of one field each let photos through.
  expect(view({ ...none, lens: ['RF 24-70mm', 'RF 50mm'] })).toEqual(['a.jpg', 'c.jpg']);
  // Format keeps photos or videos, and leaves folders out as every filter does.
  expect(view({ ...none, format: ['Video'] })).toEqual(['clip.mp4']);
  expect(view({ ...none, format: ['Photo', 'Video'] })).toEqual([
    'a.jpg',
    'b.jpg',
    'c.jpg',
    'clip.mp4',
    'd.jpg',
  ]);
  expect(view({ ...none, camera: ['Canon EOS R5'], format: ['Video'] })).toEqual([]);
  // Filters that choose nothing leave the view as it is, folders and all.
  expect(view(none)).toEqual(view(null));
  expect(view(null)).toContain('Trips');
});

test('choices are the values photos have, once each, in natural order, with their counts', () => {
  const values = (field: FilterField) => filterChoices(entries, field).map(({ value }) => value);
  expect(values('camera')).toEqual(['Canon EOS R5', 'FUJIFILM X-T5']);
  expect(values('lens')).toEqual(['RF 24-70mm', 'RF 50mm']);
  expect(filterChoices(entries, 'format')).toEqual([
    { count: 4, value: 'Photo' },
    { count: 1, value: 'Video' },
  ]);
  expect(filterChoices(entries, 'tag')).toEqual([
    { count: 2, value: 'Beach' },
    { count: 1, value: 'Family' },
  ]);
});

test('searching finds photos by their tags as well as their names', () => {
  const found = arrangeView(entries, 'grid', { descending: false, search: 'fam', sort: 'name' });
  expect(found.map((entry) => entry.name)).toEqual(['a.jpg']);
});
