import { folder } from '#photos/worker/__tests__/launches';
import { isOfflineError } from '#photos/worker/fs-errors';
import {
  filesOwnFailures,
  mountPointOf,
  probeOf,
  type Reach,
  reachFrom,
  Share,
} from '#photos/worker/share/share';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from 'vitest';

/** A share that a look always finds as `reach` says. */
function at(reach: Reach) {
  return new Share(() => Promise.resolve(reach));
}

function failed(code: string) {
  return { error: Object.assign(new Error(code), { code }) };
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
  const mounted = { parent: { dev: 1 }, point: { dev: 2 } };
  expect(reachFrom({ dev: 2 }, mounted)).toBe('online');
  expect(reachFrom(failed('ENOENT'), mounted)).toBe('gone');
  // Its mount point is gone, or left behind as an empty folder of the disk holding it.
  expect(reachFrom(failed('ENOENT'), { parent: { dev: 1 }, point: failed('ENOENT') })).toBe(
    'offline',
  );
  expect(reachFrom({ dev: 1 }, { parent: { dev: 1 }, point: { dev: 1 } })).toBe('offline');
  expect(reachFrom(failed('EHOSTDOWN'), mounted)).toBe('offline');
  expect(reachFrom(failed('ETIMEDOUT'))).toBe('offline');
  // A folder on the system's own disk is there or gone.
  expect(reachFrom(failed('ENOENT'))).toBe('gone');
  // Reads of a folder the app may not read say so themselves.
  expect(reachFrom(failed('EACCES'))).toBe('online');
  expect(isOfflineError(failed('ENOTCONN').error)).toBe(true);
  expect(isOfflineError(failed('ENOENT').error)).toBe(false);
});

test('a probe looks at the folder and its mount point on disk', async () => {
  const disk = await folder('share-');
  const root = path.join(disk, 'Volume', 'Library');
  await mkdir(root, { recursive: true });
  await expect(probeOf(root, null)()).resolves.toBe('online');
  await expect(probeOf(path.join(disk, 'Gone'), null)()).resolves.toBe('gone');
  // A mount point on the same disk as the folder holding it has nothing mounted on it.
  await expect(probeOf(root, path.join(disk, 'Volume'))()).resolves.toBe('offline');
  await expect(probeOf(root, path.join(disk, 'Unmounted'))()).resolves.toBe('offline');
});

test('a share confirms with a look that begins after it is asked', async () => {
  const looks: PromiseWithResolvers<'online' | 'offline'>[] = [];
  const share = new Share(() => {
    const look = Promise.withResolvers<'online' | 'offline'>();
    looks.push(look);
    return look.promise;
  });
  const checking = share.check();
  const confirming = share.confirm();
  looks[0]?.resolve('online');
  await expect(checking).resolves.toBe('online');
  // The look under way began before, so another follows it.
  await expect.poll(() => looks.length).toBe(2);
  looks[1]?.resolve('offline');
  await expect(confirming).resolves.toBe(false);
  expect(share.reach).toBe('offline');
});

test('a failure to read a photo is its file’s own only while the library’s folder is there, and not as a share goes', async () => {
  const failures = ['ENOENT', 'EACCES', 'ENOTCONN', 'EHOSTDOWN', 'ETIMEDOUT', 'EIO'].map((code) =>
    failed(code),
  );
  await expect(filesOwnFailures(at('online'), failures)).resolves.toEqual(failures.slice(0, 2));
  await expect(filesOwnFailures(at('offline'), failures)).resolves.toEqual([]);
  await expect(filesOwnFailures(at('gone'), failures)).resolves.toEqual([]);
});
