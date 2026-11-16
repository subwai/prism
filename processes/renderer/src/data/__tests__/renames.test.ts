import { followRenames, rebase, withRename } from '#data/renames';
import { expect, test } from 'vitest';

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

test('moves an entry, or one inside a folder renamed, to its new ID', () => {
  expect(rebase('Trips', 'Trips', 'Holidays')).toBe('Holidays');
  expect(rebase('Trips/Rome/Day 1', 'Trips', 'Holidays')).toBe('Holidays/Rome/Day 1');
  expect(rebase('Trips 2/Rome', 'Trips', 'Holidays')).toBe('Trips 2/Rome');
});
