import { Renames } from '#data/renames';
import type { PhotoEntry } from '@prism/shared';
import { expect, test } from 'vitest';

function folder(id: string, parentId: string): PhotoEntry {
  return { id, kind: 'directory', name: id.split('/').at(-1) ?? id, parentId };
}

test('follows renamed entries, and entries inside renamed folders', () => {
  const renames = new Renames();
  renames.record('Trips', 'Holidays', new Map());
  renames.record('Holidays/beach.jpg', 'Holidays/sand.jpg', new Map());
  expect(renames.follow('Trips')).toBe('Holidays');
  expect(renames.follow('Trips/Rome/day.jpg')).toBe('Holidays/Rome/day.jpg');
  expect(renames.follow('Trips/beach.jpg')).toBe('Holidays/sand.jpg');
  expect(renames.follow('Trips 2')).toBe('Trips 2');
  expect(renames.follow(String.raw`Trips\Rome`)).toBe(String.raw`Holidays\Rome`);
});

test('a name renamed back to leads nowhere', () => {
  const renames = new Renames();
  renames.record('a.jpg', 'b.jpg', new Map());
  renames.record('b.jpg', 'a.jpg', new Map());
  expect(renames.follow('a.jpg')).toBe('a.jpg');
  expect(renames.follow('b.jpg')).toBe('a.jpg');
});

test('moves the folders inside a renamed one to their new IDs', () => {
  const folders = new Map(
    [folder('Trips', '.'), folder('Trips/Rome', 'Trips'), folder('Other', '.')].map((entry) => [
      entry.id,
      entry,
    ]),
  );
  new Renames().record('Trips', 'Holidays', folders);
  expect([...folders.keys()]).toEqual(['Trips', 'Other', 'Holidays/Rome']);
  expect(folders.get('Trips')).toMatchObject({ id: 'Trips' });
  expect(folders.get('Holidays/Rome')).toMatchObject({ parentId: 'Holidays' });
});
