import { arrangeEntries, describeExif, extendsLineage } from '#data/entries';
import { folderURL, scanDetail, sortOrder } from '#data/urls';
import type { PhotoEntry } from '@prism/shared';
import { expect, test } from 'vitest';

const entries: PhotoEntry[] = [
  { id: '10', kind: 'image', name: 'Photo 10.jpg', parentId: '.' },
  { id: '2', kind: 'image', name: 'Photo 2.jpg', parentId: '.' },
  { id: 'folder', kind: 'directory', name: 'Trips', parentId: '.' },
  { id: 'clip', kind: 'video', name: 'Photo 3.mp4', parentId: '.' },
  { id: 'note', kind: 'file', name: 'Notes.txt', parentId: '.' },
];

test('sorts naturally, keeps folders first, and preserves the source array', () => {
  expect(arrangeEntries(entries, '', 'name', false).map((entry) => entry.id)).toEqual([
    'folder',
    '2',
    'clip',
    '10',
  ]);
  expect(arrangeEntries(entries, '', 'name', true).map((entry) => entry.id)).toEqual([
    'folder',
    '10',
    'clip',
    '2',
  ]);
  expect(entries.map((entry) => entry.id)).toEqual(['10', '2', 'folder', 'clip', 'note']);
});

test('searches the current view and keeps photos and videos in the recursive filmstrip', () => {
  expect(
    arrangeEntries(entries, ' PHOTO 2 ', 'name', false, true).map((entry) => entry.id),
  ).toEqual(['2']);
  expect(arrangeEntries(entries, '', 'name', false, true)).toHaveLength(3);
});

/** A file last modified at `modifiedMs`. */
function file(modifiedMs: number) {
  return { accessedMs: 0, createdMs: 0, modifiedMs, size: 1 };
}

test('sorts by when photos were taken, and by modified time where none is known', () => {
  const taken: PhotoEntry[] = [
    {
      exif: { takenMs: 300 },
      id: 'late',
      kind: 'image',
      metadata: file(1),
      name: 'a',
      parentId: '.',
    },
    { exif: {}, id: 'untimed', kind: 'image', metadata: file(200), name: 'b', parentId: '.' },
    { id: 'clip', kind: 'video', metadata: file(250), name: 'c', parentId: '.' },
    {
      exif: { takenMs: 100 },
      id: 'early',
      kind: 'image',
      metadata: file(900),
      name: 'd',
      parentId: '.',
    },
  ];
  expect(arrangeEntries(taken, '', 'taken', false).map((entry) => entry.id)).toEqual([
    'early',
    'untimed',
    'clip',
    'late',
  ]);
  expect(scanDetail(new URLSearchParams('sort=taken'))).toEqual({ exif: true, metadata: true });
  expect(scanDetail(new URLSearchParams('sort=size'))).toEqual({ exif: false, metadata: true });
  expect(scanDetail(new URLSearchParams())).toEqual({ exif: false, metadata: false });
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

test('a growing scan sorts only what each page adds, matching a full sort', () => {
  const names = Array.from({ length: 300 }, (_entry, index) => `IMG ${(index * 7919) % 300}.jpg`);
  const all: PhotoEntry[] = names.map((name) => ({ id: name, kind: 'image', name, parentId: '.' }));
  const lineage = {};
  let shown: PhotoEntry[] = [];
  for (let end = 50; end <= all.length; end += 50) {
    const page = all.slice(0, end);
    extendsLineage(page, lineage);
    shown = arrangeEntries(page, '', 'name', false);
  }
  const fresh = all.map((entry) => ({ ...entry }));
  expect(shown.map((entry) => entry.id)).toEqual(
    arrangeEntries(fresh, '', 'name', false).map((entry) => entry.id),
  );
  expect(arrangeEntries(all, '', 'name', false)).toBe(arrangeEntries(all, '', 'name', false));
  expect(
    arrangeEntries(all, 'IMG 1', 'name', false).every((entry) => entry.name.startsWith('IMG 1')),
  ).toBe(true);
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
