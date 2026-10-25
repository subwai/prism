import { folderLocation, isLocalMount, isUNCPath } from '#photos/location';
import { tmpdir } from 'node:os';
import { expect, test } from 'vitest';

const MOUNTS = [
  '/dev/disk3s1s1 on / (apfs, sealed, local, read-only, journaled)',
  '/dev/disk3s5 on /System/Volumes/Data (apfs, local, journaled, nobrowse, protect, root data)',
  '/dev/disk2s2 on /Volumes/Recovery 1 (apfs, local, journaled)',
  '//adam@nas._smb._tcp.local/Photos on /Volumes/Photos (smbfs, nodev, nosuid, mounted by adam)',
  '/dev/disk5s1 on /Volumes/Photos/Card (exfat, local, nodev, nosuid, noowners)',
].join('\n');

test('a folder takes its location from the deepest mount holding it', () => {
  expect(isLocalMount(MOUNTS, '/Users/adam/Pictures')).toBe(true);
  expect(isLocalMount(MOUNTS, '/Volumes/Recovery 1/Photos')).toBe(true);
  expect(isLocalMount(MOUNTS, '/Volumes/Photos')).toBe(false);
  expect(isLocalMount(MOUNTS, '/Volumes/Photos/2024')).toBe(false);
  expect(isLocalMount(MOUNTS, '/Volumes/Photos/Card/DCIM')).toBe(true);
  // A name that merely starts like a mount point is not inside it.
  expect(isLocalMount(MOUNTS, '/Volumes/Photos Backup')).toBe(true);
});

test('Windows network shares are UNC paths, and device paths are local', () => {
  expect(isUNCPath(String.raw`\\nas\Photos\2024`)).toBe(true);
  expect(isUNCPath(String.raw`C:\Users\adam\Pictures`)).toBe(false);
  expect(isUNCPath(String.raw`\\?\Volume{4c1b02c1-d990-11dc-99ae-806e6f6e6963}\Photos`)).toBe(
    false,
  );
  expect(isUNCPath(String.raw`\\.\PhysicalDrive0`)).toBe(false);
});

test('a folder on this computer is local', async () => {
  await expect(folderLocation(tmpdir())).resolves.toBe('local');
});
