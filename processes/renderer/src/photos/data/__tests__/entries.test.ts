import { arrangeEntries } from '#photos/data/entries';
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
