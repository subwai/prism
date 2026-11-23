import { PhotoLibrary } from '#photos/worker/library/library';
import { Catalog, prepareIndex, prepareRatings } from '@prism/catalog';
import { treeListingFromText } from '@prism/shared';
import { mkdir, mkdtemp, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, onTestFinished, test, vi } from 'vitest';

async function folder(prefix: string) {
  const made = await mkdtemp(path.join(tmpdir(), prefix));
  onTestFinished(() => rm(made, { force: true, recursive: true }));
  return realpath(made);
}

/** Opens the library at `root` on the catalog kept in `catalog`, as each launch does. */
function launch(root: string, catalog: string) {
  const library = PhotoLibrary.open(root, {
    files: {
      index: prepareIndex(path.join(catalog, 'index.db')),
      ratings: prepareRatings(path.join(catalog, 'ratings.db')),
    },
  });
  onTestFinished(() => library.close());
  return library;
}

async function folderIds(library: PhotoLibrary) {
  const { folders } = treeListingFromText(await library.listWholeTree());
  return folders.flatMap(([, subfolders]) => subfolders.map(([id]) => id)).toSorted();
}

test('each launch reads every folder once, so the catalog learns what changed meanwhile', async () => {
  const root = await folder('every-folder-');
  const catalog = await folder('every-folder-catalog-');
  await mkdir(path.join(root, 'Trips', 'Beach'), { recursive: true });
  await mkdir(path.join(root, 'Album'));
  const first = launch(root, catalog);
  await first.checkEveryFolder();
  expect(await folderIds(first)).toEqual(['Album', 'Trips', 'Trips/Beach']);
  await first.close();

  // While the app was closed, a folder went and others came, deep inside one known.
  await rm(path.join(root, 'Trips', 'Beach'), { recursive: true });
  await mkdir(path.join(root, 'Album', 'Kids', 'Party'), { recursive: true });
  await writeFile(path.join(root, 'Album', 'Kids', 'Party', 'a.jpg'), '');
  const again = launch(root, catalog);
  // The catalog shows what it had at once.
  expect(await folderIds(again)).toEqual(['Album', 'Trips', 'Trips/Beach']);
  await again.checkEveryFolder();
  expect(await folderIds(again)).toEqual(['Album', 'Album/Kids', 'Album/Kids/Party', 'Trips']);
  await expect(again.listFolder('Album/Kids/Party')).resolves.toMatchObject({ read: true });
});

test('a library whose folder is gone opens from its catalog, and reads nothing inside it', async () => {
  const root = await folder('every-folder-');
  const catalog = await folder('every-folder-catalog-');
  await mkdir(path.join(root, 'Trips', 'Beach'), { recursive: true });
  const first = launch(root, catalog);
  await first.checkEveryFolder();
  await first.close();

  // As a share that is offline, or a folder moved away.
  await rename(root, `${root}-away`);
  onTestFinished(() => rm(`${root}-away`, { force: true, recursive: true }));
  const again = launch(root, catalog);
  const changedFolders: string[] = [];
  again.onFoldersChanged(({ folders }) => changedFolders.push(...folders));
  await again.checkEveryFolder();
  await expect.poll(() => changedFolders).toEqual(['.']);
  await expect(again.listFolder('.')).resolves.toMatchObject({ missing: true });
  expect(await folderIds(again)).toEqual(['Trips', 'Trips/Beach']);
});

test('the first walk reads everything inside a folder the window read before it got there', async () => {
  const root = await folder('every-folder-');
  await mkdir(path.join(root, 'Album', 'Kids', 'Party'), { recursive: true });
  await writeFile(path.join(root, 'Album', 'Kids', 'Party', 'a.jpg'), '');
  const files = { index: ':memory:', ratings: ':memory:' };
  const library = PhotoLibrary.open(root, {
    connect: (opened, at) => {
      const catalog = Catalog.inProcess(opened, at);
      // Typed loosely, as a stand-in for every method of `call` at once.
      const call = catalog.call.bind(catalog) as (...args: unknown[]) => Promise<unknown>;
      // The window reads a folder once the walk has asked the empty catalog what it holds.
      vi.spyOn(catalog, 'call').mockImplementation((async (...args: unknown[]) => {
        const answer = await call(...args);
        if (args[0] === 'foldersInside') {
          await library.readFolder('Album');
        }
        return answer;
      }) as typeof catalog.call);
      return catalog;
    },
    files,
  });
  onTestFinished(() => library.close());
  await library.checkEveryFolder();
  expect(await folderIds(library)).toEqual(['Album', 'Album/Kids', 'Album/Kids/Party']);
  await expect(library.listFolder('Album/Kids/Party')).resolves.toMatchObject({
    entries: [expect.objectContaining({ id: 'Album/Kids/Party/a.jpg' })],
    read: true,
  });
});
