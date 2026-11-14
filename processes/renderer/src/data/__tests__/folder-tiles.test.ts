import { holdsFolders, unsettled } from '#data/folder-tiles';
import { expect, test } from 'vitest';

test('a tile is settled once its folder was read and has covers, or nothing to lend them', () => {
  const read = { covers: [], hasEntries: true, hasSubfolders: false, read: true };
  expect(unsettled()).toBe(true);
  expect(unsettled({ ...read, read: false })).toBe(true);
  expect(unsettled(read)).toBe(false);
  // Folders inside may lend it covers once read.
  expect(unsettled({ ...read, hasSubfolders: true })).toBe(true);
});

test('a tile says a folder holds no folders only once the folder was read', () => {
  const unread = { covers: [], hasEntries: false, hasSubfolders: false, read: false };
  expect(holdsFolders()).toBeUndefined();
  expect(holdsFolders(unread)).toBeUndefined();
  expect(holdsFolders({ ...unread, read: true })).toBe(false);
  expect(holdsFolders({ ...unread, hasSubfolders: true })).toBe(true);
});
