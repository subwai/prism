import { PhotoLibrary } from '#photos/worker/library';
import { prepareIndex, prepareRatings } from '@prism/catalog';
import { mkdir, mkdtemp, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, onTestFinished, test } from 'vitest';

async function folder(prefix: string) {
  const made = await mkdtemp(path.join(tmpdir(), prefix));
  onTestFinished(() => rm(made, { force: true, recursive: true }));
  return realpath(made);
}

/** Opens the library at `root` on the catalog kept in `catalog`, as each launch does. */
function launch(root: string, catalog: string) {
  const library = PhotoLibrary.open(root, {
    index: prepareIndex(path.join(catalog, 'index.db')),
    ratings: prepareRatings(path.join(catalog, 'ratings.db')),
  });
  onTestFinished(() => library.close());
  return library;
}

async function folderIds(library: PhotoLibrary) {
  const { folders } = await library.folderSkeleton();
  return folders.map(([id]) => id).toSorted();
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
  const relisted: string[] = [];
  again.onRelisted((ids) => relisted.push(...ids));
  await again.checkEveryFolder();
  await expect.poll(() => relisted).toEqual(['.']);
  await expect(again.listFolder('.')).resolves.toMatchObject({ missing: true });
  expect(await folderIds(again)).toEqual(['Trips', 'Trips/Beach']);
});
