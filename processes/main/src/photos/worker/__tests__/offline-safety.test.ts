import { entriesIn, folder } from '#photos/worker/__tests__/launches';
import { differs } from '#photos/worker/indexer/write-changed-entries';
import { PhotoLibrary } from '#photos/worker/library';
import { type Reach, Share } from '#photos/worker/share/share';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
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

test('a folder read while its share is offline waits for it, and removes nothing meanwhile', async () => {
  const { library, root, share } = await readLibrary();
  share.reach = 'offline';
  // As an unmounted volume leaves its mount point.
  await rename(root, `${root}-away`);
  await mkdir(root);
  library.forget();
  let settled = false;
  const reading = library.readFolder('.').finally(() => {
    settled = true;
  });
  await expect.poll(() => library.share.reach).toBe('offline');
  expect(settled).toBe(false);
  const { entries, missing } = await library.listFolder('.');
  expect({ ids: entries.map(({ id }) => id), missing }).toEqual({
    ids: ['Trips', 'b.jpg'],
    missing: false,
  });
  // Back, as it was.
  await rm(root, { recursive: true });
  await rename(`${root}-away`, root);
  share.reach = 'online';
  await library.share.check();
  await expect(reading).resolves.toMatchObject({ error: null });
  expect((await entriesIn(library, '.')).map(({ id }) => id)).toEqual(['Trips', 'b.jpg']);
});

test('a library whose share is offline opens from its catalog, and checks every folder once it is back', async () => {
  const { library, root, share } = await readLibrary();
  await rename(root, `${root}-away`);
  share.reach = 'offline';
  await library.share.check();
  library.forget();
  const checked = library.checkEveryFolder();
  await expect(library.listFolder('.')).resolves.toMatchObject({ missing: false, read: true });
  expect((await library.listSubfolders(['.'])).folders).toHaveLength(1);
  // What changed meanwhile, the next check finds.
  await rename(`${root}-away`, root);
  await writeFile(path.join(root, 'Trips', 'c.jpg'), 'c');
  share.reach = 'online';
  await library.share.check();
  await checked;
  expect((await entriesIn(library, 'Trips')).map(({ id }) => id)).toEqual([
    path.join('Trips', 'a.jpg'),
    path.join('Trips', 'c.jpg'),
  ]);
});

test('a library gone from a share that is there is missing', async () => {
  const { library, root, share } = await readLibrary();
  await rename(root, `${root}-away`);
  onTestFinished(() => rm(`${root}-away`, { force: true, recursive: true }));
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
