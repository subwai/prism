import { folder } from '#photos/worker/__tests__/launches';
import { isOfflineError } from '#photos/worker/fs-errors';
import {
  createShareCheck,
  filesOwnFailures,
  mountPointOf,
  Share,
  type ShareState,
  shareStateFrom,
} from '#photos/worker/share/share';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from 'vitest';

/** A share that every check finds in `state`. */
function at(state: ShareState) {
  return new Share(() => Promise.resolve(state));
}

function failed(code: string) {
  return { error: Object.assign(new Error(code), { code }), kind: 'failed' as const };
}

test('a folder is on a volume of its own where each system mounts them', () => {
  expect(mountPointOf('/Volumes/components/drivers', 'darwin')).toBe('/Volumes/components');
  expect(mountPointOf('/Volumes/Photos', 'darwin')).toBe('/Volumes/Photos');
  expect(mountPointOf('/Users/adam/Pictures', 'darwin')).toBeNull();
  expect(mountPointOf('/media/adam/Photos/2024', 'linux')).toBe('/media/adam/Photos');
  expect(mountPointOf('/run/media/adam/Photos/2024', 'linux')).toBe('/run/media/adam/Photos');
  expect(mountPointOf('/mnt/share/2024', 'linux')).toBe('/mnt/share');
  expect(mountPointOf('/home/adam/Pictures', 'linux')).toBeNull();
  expect(mountPointOf(String.raw`\\nas\photos\2024`, 'win32')).toBe(String.raw`\\nas\photos`);
  expect(mountPointOf(String.raw`E:\Photos`, 'win32')).toBe('E:');
});

test('a volume not mounted, or one that does not answer, is offline, and a folder gone from one that is, gone', () => {
  const mounted = { parent: { dev: 1, kind: 'found' }, point: { dev: 2, kind: 'found' } } as const;
  expect(shareStateFrom({ dev: 2, kind: 'found' }, mounted)).toBe('online');
  expect(shareStateFrom(failed('ENOENT'), mounted)).toBe('gone');
  // Its mount point is gone, or left behind as an empty folder of the disk holding it.
  expect(
    shareStateFrom(failed('ENOENT'), {
      parent: { dev: 1, kind: 'found' },
      point: failed('ENOENT'),
    }),
  ).toBe('offline');
  expect(
    shareStateFrom(
      { dev: 1, kind: 'found' },
      { parent: { dev: 1, kind: 'found' }, point: { dev: 1, kind: 'found' } },
    ),
  ).toBe('offline');
  expect(shareStateFrom(failed('EHOSTDOWN'), mounted)).toBe('offline');
  expect(shareStateFrom(failed('ETIMEDOUT'))).toBe('offline');
  // A folder on the system's own disk is there or gone.
  expect(shareStateFrom(failed('ENOENT'))).toBe('gone');
  // Reads of a folder the app may not read say so themselves.
  expect(shareStateFrom(failed('EACCES'))).toBe('online');
  expect(isOfflineError(failed('ENOTCONN').error)).toBe(true);
  expect(isOfflineError(failed('ENOENT').error)).toBe(false);
});

test('a share check checks at the folder and its mount point on disk', async () => {
  const disk = await folder('share-');
  const root = path.join(disk, 'Volume', 'Library');
  await mkdir(root, { recursive: true });
  await expect(createShareCheck(root, null)()).resolves.toBe('online');
  await expect(createShareCheck(path.join(disk, 'Gone'), null)()).resolves.toBe('gone');
  // A mount point on the same disk as the folder holding it has nothing mounted on it.
  await expect(createShareCheck(root, path.join(disk, 'Volume'))()).resolves.toBe('offline');
  await expect(createShareCheck(root, path.join(disk, 'Unmounted'))()).resolves.toBe('offline');
});

test('isVolumeThere checks again, starting after it is asked', async () => {
  const checks: PromiseWithResolvers<'online' | 'offline'>[] = [];
  const share = new Share(() => {
    const check = Promise.withResolvers<'online' | 'offline'>();
    checks.push(check);
    return check.promise;
  });
  const checking = share.check();
  const confirming = share.isVolumeThere();
  checks[0]?.resolve('online');
  await expect(checking).resolves.toBe('online');
  // The check under way began before, so another follows it.
  await expect.poll(() => checks.length).toBe(2);
  checks[1]?.resolve('offline');
  await expect(confirming).resolves.toBe(false);
  expect(share.state).toBe('offline');
});

test('a failure to read a photo is its file’s own only while the library’s folder is there, and not as a share goes', async () => {
  const failures = ['ENOENT', 'EACCES', 'ENOTCONN', 'EHOSTDOWN', 'ETIMEDOUT', 'EIO'].map((code) =>
    failed(code),
  );
  await expect(filesOwnFailures(at('online'), failures)).resolves.toEqual(failures.slice(0, 2));
  await expect(filesOwnFailures(at('offline'), failures)).resolves.toEqual([]);
  await expect(filesOwnFailures(at('gone'), failures)).resolves.toEqual([]);
});
