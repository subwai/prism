import { follow, withFoldersMoved, withRename } from '#data/renames';
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
  expect(follow(renames, 'Trips')).toBe('Holidays');
  expect(follow(renames, 'Trips/Rome/day.jpg')).toBe('Holidays/Rome/day.jpg');
  expect(follow(renames, 'Trips/beach.jpg')).toBe('Holidays/sand.jpg');
  expect(follow(renames, 'Trips 2')).toBe('Trips 2');
  expect(follow(renames, String.raw`Trips\Rome`)).toBe(String.raw`Holidays\Rome`);
});

test('a name renamed back to leads nowhere', () => {
  const renames = withRename(withRename(new Map(), 'a.jpg', 'b.jpg'), 'b.jpg', 'a.jpg');
  expect(follow(renames, 'a.jpg')).toBe('a.jpg');
  expect(follow(renames, 'b.jpg')).toBe('a.jpg');
});

test('moves the folders inside a renamed one to their new IDs', () => {
  const folders = new Map(
    [folder('Trips', '.'), folder('Trips/Rome', 'Trips'), folder('Other', '.')].map((entry) => [
      entry.id,
      entry,
    ]),
  );
  const moved = withFoldersMoved(folders, 'Trips', 'Holidays');
  expect([...moved.keys()]).toEqual(['Trips', 'Other', 'Holidays/Rome']);
  expect(moved.get('Trips')).toMatchObject({ id: 'Trips' });
  expect(moved.get('Holidays/Rome')).toMatchObject({ parentId: 'Holidays' });
  expect([...folders.keys()]).toEqual(['Trips', 'Trips/Rome', 'Other']);
});
