import { entriesIn, folder } from '#photos/worker/__tests__/launches';
import { differs } from '#photos/worker/index-writes';
import { PhotoLibrary } from '#photos/worker/library';
import { type Reach, Share } from '#photos/worker/share';
import { mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, onTestFinished, test } from 'vitest';

/** A library of `Trips/a.jpg` and `b.jpg`, read once, whose share is as `reach` says. */
async function readLibrary() {
  const root = await folder('offline-safety-');
  await mkdir(path.join(root, 'Trips'));
  await writeFile(path.join(root, 'Trips', 'a.jpg'), 'a');
  await writeFile(path.join(root, 'b.jpg'), 'b');
  const share = { reach: 'online' as Reach };
  const library = PhotoLibrary.open(
    root,
    undefined,
    undefined,
    Date.now,
    new Share(() => Promise.resolve(share.reach)),
  );
  onTestFinished(() => library.close());
  await library.checkEveryFolder();
  return { library, root, share };
}

/** Empties `root` on disk, as a volume unmounted leaves its mount point. */
async function empty(root: string) {
  const names = await readdir(root);
  await Promise.all(names.map((name) => rm(path.join(root, name), { recursive: true })));
}

test('a folder read while its share is offline removes nothing, though it lists nothing', async () => {
  const { library, root, share } = await readLibrary();
  share.reach = 'offline';
  await empty(root);
  library.forget();
  await expect(library.readFolder('.')).resolves.toMatchObject({
    error: 'The share this library is on is offline.',
    missing: false,
  });
  library.forget();
  const { entries } = await library.listFolder('.');
  expect(entries.map(({ id }) => id)).toEqual(['Trips', 'b.jpg']);
});

test('a library whose share is offline is not missing, and keeps what its catalog has', async () => {
  const { library, root, share } = await readLibrary();
  await rename(root, `${root}-away`);
  onTestFinished(() => rm(`${root}-away`, { force: true, recursive: true }));
  share.reach = 'offline';
  library.forget();
  await library.checkEveryFolder();
  await expect(library.listFolder('.')).resolves.toMatchObject({ missing: false });
  // Once it is gone from a share that is there, it is missing.
  share.reach = 'gone';
  library.forget();
  await library.readFolder('.');
  await expect(library.listFolder('.')).resolves.toMatchObject({ missing: true });
});

test('a change the watcher saw just before the share went removes nothing', async () => {
  const { library, root, share } = await readLibrary();
  await rm(path.join(root, 'b.jpg'));
  share.reach = 'offline';
  const gone = { id: 'b.jpg', parentId: '.' };
  await expect(library.describeChanges([gone])).resolves.toEqual([]);
  expect((await entriesIn(library, '.')).map(({ id }) => id)).toContain('b.jpg');
  share.reach = 'online';
  await expect(library.describeChanges([gone])).resolves.toMatchObject([
    { entry: null, id: 'b.jpg' },
  ]);
});

test('an entry listed but not looked at keeps what the catalog knew of it', () => {
  const known = { id: 'a.jpg', inode: '7', kind: 'image' as const, modifiedMs: 1, size: 2 };
  const listed = { id: 'a.jpg', kind: 'image' as const, name: 'a.jpg', parentId: '.' };
  expect(differs(known, listed)).toBe(false);
  expect(differs(known, { ...listed, kind: 'directory' })).toBe(true);
  expect(differs(undefined, listed)).toBe(true);
});
