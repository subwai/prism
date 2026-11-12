import { restoreItem, trashItem } from '@prism/trash';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, onTestFinished, test } from 'vitest';

const linux = process.platform === 'linux';

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'prism-trash-'));
  onTestFinished(() => rm(root, { force: true, recursive: true }));
  if (linux) {
    // The home Trash, here, rather than the one of whoever runs the tests.
    const before = process.env.XDG_DATA_HOME;
    process.env.XDG_DATA_HOME = path.join(root, 'data');
    onTestFinished(() => {
      if (before === undefined) {
        delete process.env.XDG_DATA_HOME;
      } else {
        process.env.XDG_DATA_HOME = before;
      }
    });
  }
  return root;
}

/** Moves what a test trashed back where it was, so it leaves nothing in the system's Trash. */
function takeBack(landed: string, to: string) {
  onTestFinished(async () => {
    try {
      await restoreItem(landed, to);
    } catch {
      // The test moved it back already.
    }
  });
}

test('files and folders go to the Trash, each saying where, though their names are taken', async () => {
  const root = await fixture();
  // A name no earlier run left in the Trash.
  const name = `prism-test-${path.basename(root)}`;
  await mkdir(path.join(root, 'a', name), { recursive: true });
  await writeFile(path.join(root, 'a', name, 'photo.jpg'), 'first');
  await mkdir(path.join(root, 'b'));
  await writeFile(path.join(root, 'b', name), 'second');

  const folder = await trashItem(path.join(root, 'a', name));
  takeBack(folder, path.join(root, 'a', name));
  const file = await trashItem(path.join(root, 'b', name));
  takeBack(file, path.join(root, 'b', name));

  expect(file).not.toBe(folder);
  await expect(readFile(path.join(folder, 'photo.jpg'), 'utf8')).resolves.toBe('first');
  await expect(readFile(file, 'utf8')).resolves.toBe('second');
  await expect(stat(path.join(root, 'b', name))).rejects.toThrow();
});

test('what went to the Trash comes back, under the name asked for', async () => {
  const root = await fixture();
  const name = `prism-test-${path.basename(root)}.txt`;
  await writeFile(path.join(root, name), 'kept');

  const landed = await trashItem(path.join(root, name));
  const back = path.join(root, `restored-${name}`);
  await restoreItem(landed, back);

  await expect(readFile(back, 'utf8')).resolves.toBe('kept');
  await expect(stat(landed)).rejects.toThrow();
});

test('nothing at the path to trash is an error', async () => {
  const root = await fixture();
  await expect(trashItem(path.join(root, 'missing.jpg'))).rejects.toThrow();
});

test.runIf(linux)(
  'the freedesktop Trash records where an item was, and forgets it once back',
  async () => {
    const root = await fixture();
    await mkdir(path.join(root, 'Trips 2024'));
    await writeFile(path.join(root, 'Trips 2024', 'beach.jpg'), 'sand');

    const landed = await trashItem(path.join(root, 'Trips 2024', 'beach.jpg'));
    const trash = path.join(root, 'data', 'Trash');
    expect(landed).toBe(path.join(trash, 'files', 'beach.jpg'));
    const record = path.join(trash, 'info', 'beach.jpg.trashinfo');
    const info = await readFile(record, 'utf8');
    expect(info).toContain(`Path=${path.join(root, 'Trips%202024', 'beach.jpg')}\n`);
    expect(info).toMatch(/^DeletionDate=\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$/mu);

    await writeFile(path.join(root, 'beach.jpg'), 'again');
    await expect(trashItem(path.join(root, 'beach.jpg'))).resolves.toBe(
      path.join(trash, 'files', 'beach 2.jpg'),
    );

    await restoreItem(landed, path.join(root, 'beach.jpg'));
    await expect(stat(record)).rejects.toThrow();
  },
);
