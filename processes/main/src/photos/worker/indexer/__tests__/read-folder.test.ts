import { readFolder, type ReadItem } from '#photos/worker/indexer/read-folder';
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
  const items: ReadItem[] = [];
  const resolve = (id: string) => Promise.resolve(path.join(root, id));
  for await (const item of readFolder(root, '.', {
    resolve,
    signal: new AbortController().signal,
  })) {
    items.push(item);
  }
  return items;
}

test('a folder whose entries were listed but not there to look at is still stamped', async () => {
  const items = await readAll(await failingFolder('ENOENT'));
  expect(items).toContainEqual({ entry: expect.objectContaining({ id: 'Tesla ' }), kind: 'entry' });
  // Its failure is still reported, but the read still counts for the folder.
  expect(items).toContainEqual({
    error: expect.objectContaining({ entryId: 'Tesla ' }),
    kind: 'error',
  });
  expect(items.at(-1)).toHaveProperty('stamp');
});

test('a folder whose entries could not be looked at otherwise is left unstamped', async () => {
  const items = await readAll(await failingFolder('EIO'));
  expect(items).toContainEqual({
    error: expect.objectContaining({ entryId: 'Tesla ' }),
    kind: 'error',
  });
  expect(items.some((item) => item.kind === 'stamp')).toBe(false);
});
