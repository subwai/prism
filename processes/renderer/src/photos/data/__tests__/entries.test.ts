import { arrangeEntries, extendsLineage } from '#photos/data/entries';
import { folderURL, sortOrder } from '#photos/data/urls';
import type { PhotoEntry } from '@prism/shared';
import { expect, test } from 'vitest';

const entries: PhotoEntry[] = [
  { id: '10', kind: 'image', name: 'Photo 10.jpg', parentId: '.' },
  { id: '2', kind: 'image', name: 'Photo 2.jpg', parentId: '.' },
  { id: 'folder', kind: 'directory', name: 'Trips', parentId: '.' },
  { id: 'clip', kind: 'video', name: 'Photo 3.mp4', parentId: '.' },
  { id: 'note', kind: 'file', name: 'Notes.txt', parentId: '.' }
];

test('sorts naturally, keeps folders first, and preserves the source array', () => {
  expect(arrangeEntries(entries, '', 'name', false).map((entry) => entry.id)).toEqual([
    'folder',
    '2',
    'clip',
    '10'
  ]);
  expect(arrangeEntries(entries, '', 'name', true).map((entry) => entry.id)).toEqual([
    'folder',
    '10',
    'clip',
    '2'
  ]);
  expect(entries.map((entry) => entry.id)).toEqual(['10', '2', 'folder', 'clip', 'note']);
});

test('searches the current view and keeps photos and videos in the recursive filmstrip', () => {
  expect(
    arrangeEntries(entries, ' PHOTO 2 ', 'name', false, true).map((entry) => entry.id)
  ).toEqual(['2']);
  expect(arrangeEntries(entries, '', 'name', false, true)).toHaveLength(3);
});

test('preserves opaque folder identifiers and view settings in URLs', () => {
  const id = 'Trips/日本 & #1?100%';
  const url = new URL(
    folderURL('filmstrip', id, '?sort=modified&order=desc&q=old'),
    'https://prism.test'
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
    arrangeEntries(fresh, '', 'name', false).map((entry) => entry.id)
  );
  expect(arrangeEntries(all, '', 'name', false)).toBe(arrangeEntries(all, '', 'name', false));
  expect(
    arrangeEntries(all, 'IMG 1', 'name', false).every((entry) => entry.name.startsWith('IMG 1'))
  ).toBe(true);
});
