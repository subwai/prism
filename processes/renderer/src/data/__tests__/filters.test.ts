import { arrangeView } from '#data/entries';
import { filterChoices, matches, narrows, photoFilter } from '#data/filters';
import { scanDetail } from '#data/urls';
import type { PhotoEntry, PhotoExif } from '@prism/shared';
import { expect, test } from 'vitest';

function shot(name: string, exif?: PhotoExif): PhotoEntry {
  return { exif, id: name, kind: 'image', name, parentId: '.' };
}

const entries: PhotoEntry[] = [
  shot('a.jpg', { camera: 'Canon EOS R5', lens: 'RF 50mm' }),
  shot('b.jpg', { camera: 'FUJIFILM X-T5' }),
  shot('c.jpg', { camera: 'Canon EOS R5', lens: 'RF 24-70mm' }),
  shot('d.jpg'),
  { id: 'clip.mp4', kind: 'video', name: 'clip.mp4', parentId: '.' },
  { id: 'Trips', kind: 'directory', name: 'Trips', parentId: '.' },
];

test('filters come from the URL, and are hidden until it shows them', () => {
  expect(photoFilter(new URLSearchParams('camera=Canon'))).toBeNull();
  expect(photoFilter(new URLSearchParams('filter=1&camera=Canon'))).toEqual({
    camera: 'Canon',
    lens: '',
  });
  const shown = photoFilter(new URLSearchParams('filter=1')),
    lens = photoFilter(new URLSearchParams('filter=1&lens=RF'));
  expect(narrows(shown)).toBe(false);
  expect(narrows(lens)).toBe(true);
});

test('showing filters reads EXIF details, whatever the sort', () => {
  expect(scanDetail(new URLSearchParams('filter=1'))).toEqual({ exif: true, metadata: true });
  expect(scanDetail(new URLSearchParams('filter=1&sort=size'))).toEqual({
    exif: true,
    metadata: true,
  });
});

test('a filter keeps only the photos whose details match everything it chooses', () => {
  const filter = { camera: 'Canon EOS R5', lens: '' };
  expect(entries.filter((entry) => matches(entry, filter)).map((entry) => entry.name)).toEqual([
    'a.jpg',
    'c.jpg',
  ]);
  expect(matches(entries[0] as PhotoEntry, { ...filter, lens: 'RF 24-70mm' })).toBe(false);
  const view = (chosen: { camera: string; lens: string } | null) =>
    arrangeView(entries, 'grid', {
      descending: false,
      filter: chosen,
      search: '',
      sort: 'name',
    }).map((entry) => entry.name);
  expect(view({ camera: '', lens: 'RF 24-70mm' })).toEqual(['c.jpg']);
  // Shown filters that choose nothing leave the view as it is, folders and all.
  expect(view({ camera: '', lens: '' })).toEqual(view(null));
  expect(view(null)).toContain('Trips');
});

test('choices are the values photos have, once each, in natural order', () => {
  expect(filterChoices(entries, 'camera')).toEqual(['Canon EOS R5', 'FUJIFILM X-T5']);
  expect(filterChoices(entries, 'lens')).toEqual(['RF 24-70mm', 'RF 50mm']);
});
