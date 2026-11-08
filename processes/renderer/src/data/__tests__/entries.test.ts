import { byName, describeExif } from '#data/entries';
import { folderURL, needsDetails, sortOrder, viewSpec } from '#data/urls';
import type { PhotoEntry } from '@prism/shared';
import { expect, test } from 'vitest';

const entries: PhotoEntry[] = [
  { id: '10', kind: 'image', name: 'Photo 10.jpg', parentId: '.' },
  { id: '2', kind: 'image', name: 'Photo 2.jpg', parentId: '.' },
  { id: 'folder', kind: 'directory', name: 'Trips', parentId: '.' },
  { id: 'clip', kind: 'video', name: 'Photo 3.mp4', parentId: '.' },
];

test('lists sort naturally by name, folders first, leaving the source as it was', () => {
  expect(byName(entries).map((entry) => entry.id)).toEqual(['folder', '2', 'clip', '10']);
  expect(entries.map((entry) => entry.id)).toEqual(['10', '2', 'folder', 'clip']);
});

test('each mode shows what it shows of the folder, as the URL sorts and narrows it', () => {
  const params = new URLSearchParams('sort=taken&order=desc&q=beach&camera=Canon&suggest=1');
  expect(viewSpec(params, 'filmstrip', 'Trips')).toEqual({
    descending: true,
    directoryId: 'Trips',
    filter: { camera: ['Canon'], format: [], lens: [], tag: [] },
    recursive: true,
    search: 'beach',
    show: 'media',
    sort: 'taken',
    suggesting: true,
  });
  expect(viewSpec(new URLSearchParams(), 'grid', '.')).toMatchObject({
    recursive: false,
    show: 'all',
    sort: 'name',
  });
  expect(viewSpec(new URLSearchParams(), 'reader', '.').show).toBe('images');
});

function needs(search: string) {
  return needsDetails(viewSpec(new URLSearchParams(search), 'grid', '.'));
}

test('sorting by date taken, or filtering by what EXIF says, needs photos’ details', () => {
  expect(needs('sort=taken')).toBe(true);
  expect(needs('lens=50mm')).toBe(true);
  expect(needs('sort=size&format=Video')).toBe(false);
});

test('preserves opaque folder identifiers and view settings in URLs', () => {
  const id = 'Trips/日本 & #1?100%';
  const url = new URL(
    folderURL('filmstrip', id, '?sort=modified&order=desc&q=old'),
    'https://prism.test',
  );
  expect(url.pathname).toBe('/library/filmstrip');
  expect(url.searchParams.get('folder')).toBe(id);
  expect(sortOrder(url.searchParams)).toBe('modified');
  expect(url.searchParams.get('order')).toBe('desc');
  expect(url.searchParams.has('q')).toBe(false);
  expect(sortOrder(new URLSearchParams('sort=invalid'))).toBe('name');
});

test('EXIF details read as a camera shows them, leaving out what is unknown', () => {
  expect(
    describeExif({
      aperture: 2.8,
      camera: 'Canon EOS R5',
      exposureSeconds: 0.004,
      focalLength: 50,
      iso: 400,
    }),
  ).toBe('Canon EOS R5 · 50 mm · ƒ/2.8 · 1/250 s · ISO 400');
  expect(describeExif({ exposureSeconds: 2 })).toBe('2 s');
  expect(describeExif({})).toBe('');
});
