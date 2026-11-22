import { holdsFolders, mayTileChange } from '#data/tree/folder-summary';
import { expect, test } from 'vitest';

test('a tile stops changing once its folder was read and has covers, or no subfolders to give it some', () => {
  const read = { covers: [], hasEntries: true, hasSubfolders: false, read: true };
  expect(mayTileChange()).toBe(true);
  expect(mayTileChange({ ...read, read: false })).toBe(true);
  expect(mayTileChange(read)).toBe(false);
  // Folders inside may give it covers once read.
  expect(mayTileChange({ ...read, hasSubfolders: true })).toBe(true);
});

test('a tile says a folder holds no folders only once the folder was read', () => {
  const unread = { covers: [], hasEntries: false, hasSubfolders: false, read: false };
  expect(holdsFolders(undefined, true)).toBe(true);
  expect(holdsFolders(unread, true)).toBe(true);
  expect(holdsFolders(unread, false)).toBe(false);
  expect(holdsFolders({ ...unread, read: true }, true)).toBe(false);
  expect(holdsFolders({ ...unread, hasSubfolders: true }, false)).toBe(true);
});
