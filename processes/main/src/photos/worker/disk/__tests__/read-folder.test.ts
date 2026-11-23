import { type FolderReadPart, readFolder } from '#photos/worker/disk/read-folder';
import type * as Files from 'node:fs/promises';
import { mkdir, mkdtemp, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, onTestFinished, test, vi } from 'vitest';

// Each entry's look, as the tests make some fail.
// The typed form cannot hold `stat`'s overloads.
vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof Files>();
  return { ...actual, stat: vi.fn(actual.stat) };
});

/** A folder holding `a.jpg` and `Tesla `, whose look fails with `code`, as over SMB. */
async function failingFolder(code: string) {
  const made = await mkdtemp(path.join(tmpdir(), 'read-folder-'));
  const root = await realpath(made);
  onTestFinished(() => rm(root, { force: true, recursive: true }));
  await writeFile(path.join(root, 'a.jpg'), 'a');
  await mkdir(path.join(root, 'Tesla '));
  const { stat: actual } = await vi.importActual<typeof Files>('node:fs/promises');
  vi.mocked(stat).mockImplementation((file, options) =>
    path.basename(String(file)) === 'Tesla '
      ? Promise.reject(Object.assign(new Error(`${code}: stat`), { code }))
      : actual(file, options),
  );
  onTestFinished(() => {
    vi.mocked(stat).mockImplementation(actual);
  });
  return root;
}

async function readAll(root: string) {
  const parts: FolderReadPart[] = [];
  const resolve = (id: string) => Promise.resolve(path.join(root, id));
  for await (const part of readFolder(root, '.', {
    resolve,
    signal: new AbortController().signal,
  })) {
    parts.push(part);
  }
  return parts;
}

test('a folder whose entries were listed but not there to look at still gets its folder times', async () => {
  const parts = await readAll(await failingFolder('ENOENT'));
  expect(parts).toContainEqual({ entry: expect.objectContaining({ id: 'Tesla ' }), kind: 'entry' });
  // Its failure is still reported, but the read still counts for the folder.
  expect(parts).toContainEqual({
    error: expect.objectContaining({ entryId: 'Tesla ' }),
    kind: 'error',
  });
  expect(parts.at(-1)).toHaveProperty('times');
});

test('a folder whose entries could not be looked at otherwise is left without folder times', async () => {
  const parts = await readAll(await failingFolder('EIO'));
  expect(parts).toContainEqual({
    error: expect.objectContaining({ entryId: 'Tesla ' }),
    kind: 'error',
  });
  expect(parts.some((part) => part.kind === 'folder-times')).toBe(false);
});
