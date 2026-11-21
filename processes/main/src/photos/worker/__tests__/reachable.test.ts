import { filesOwnFailures } from '#photos/worker/reachable';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, onTestFinished, test } from 'vitest';

function failure(code: string) {
  return { error: Object.assign(new Error(code), { code }) };
}

test('a failure while the library’s folder can be reached is the file’s own, but one a share gives as it goes', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'reachable-'));
  onTestFinished(() => rm(root, { force: true, recursive: true }));
  const failures = ['ENOENT', 'EACCES', 'ENOTCONN', 'EHOSTDOWN', 'ETIMEDOUT', 'EIO'].map((code) =>
    failure(code),
  );
  expect(await filesOwnFailures(root, failures)).toEqual(failures.slice(0, 2));
});

test('no failure is the file’s own while the library’s folder cannot be reached', async () => {
  const root = path.join(tmpdir(), 'reachable-nowhere', 'offline');
  expect(await filesOwnFailures(root, [failure('ENOENT')])).toEqual([]);
});
