import { followRenames, withFoldersMoved, withRename } from '#data/renames';
import type { PhotoEntry } from '@prism/shared';
import { expect, test } from 'vitest';

function folder(id: string, parentId: string): PhotoEntry {
  return { id, kind: 'directory', name: id.split('/').at(-1) ?? id, parentId };
}

test('follows renamed entries, and entries inside renamed folders', () => {
  const renames = withRename(
    withRename(new Map(), 'Trips', 'Holidays'),
    'Holidays/beach.jpg',
    'Holidays/sand.jpg',
  );
  expect(followRenames(renames, 'Trips')).toBe('Holidays');
  expect(followRenames(renames, 'Trips/Rome/day.jpg')).toBe('Holidays/Rome/day.jpg');
  expect(followRenames(renames, 'Trips/beach.jpg')).toBe('Holidays/sand.jpg');
  expect(followRenames(renames, 'Trips 2')).toBe('Trips 2');
  expect(followRenames(renames, String.raw`Trips\Rome`)).toBe(String.raw`Holidays\Rome`);
});

test('a name renamed back to leads nowhere', () => {
  const renames = withRename(withRename(new Map(), 'a.jpg', 'b.jpg'), 'b.jpg', 'a.jpg');
  expect(followRenames(renames, 'a.jpg')).toBe('a.jpg');
  expect(followRenames(renames, 'b.jpg')).toBe('a.jpg');
});

test('moves the folders inside a renamed one to their new IDs', () => {
  const known = [
    folder('Trips', '.'),
    folder('Trips/Rome', 'Trips'),
    folder('Trips/Rome/Day 1', 'Trips/Rome'),
    folder('Other', '.'),
  ];
  const before = new Map([['Work/Old', folder('Work/Old', 'Work')]]);
  const moved = withFoldersMoved(before, known, 'Trips', 'Holidays');
  expect([...moved.keys()]).toEqual(['Work/Old', 'Holidays/Rome', 'Holidays/Rome/Day 1']);
  expect(moved.get('Holidays/Rome/Day 1')).toMatchObject({ parentId: 'Holidays/Rome' });
  expect([...before.keys()]).toEqual(['Work/Old']);
});
