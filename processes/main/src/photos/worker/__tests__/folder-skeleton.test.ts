import { PhotoLibrary } from '#photos/worker/library';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, onTestFinished, test } from 'vitest';

async function openLibrary() {
  const root = await mkdtemp(path.join(tmpdir(), 'folder-skeleton-'));
  onTestFinished(() => rm(root, { force: true, recursive: true }));
  const library = await PhotoLibrary.open(root);
  onTestFinished(() => library.close());
  return { library, root };
}

test("the tree's folders come from the catalog, and reads tell whose subfolders changed", async () => {
  const { library, root } = await openLibrary();
  await mkdir(path.join(root, 'Trips', 'Beach'), { recursive: true });
  await writeFile(path.join(root, 'Trips', 'a.jpg'), '');
  const relisted: string[] = [];
  library.onRelisted((folderId) => relisted.push(folderId));
  // Nothing is read yet, and asking reads nothing.
  await expect(library.folderSkeleton()).resolves.toEqual({ folders: [], listed: [] });
  await library.listFolder('.');
  await library.listFolder('Trips');
  expect(relisted.toSorted()).toEqual(['.', 'Trips']);
  await expect(library.folderSkeleton()).resolves.toEqual({
    folders: [
      ['Trips/Beach', 'Trips', 'Beach'],
      ['Trips', '.', 'Trips'],
    ],
    listed: ['.', 'Trips'],
  });

  relisted.length = 0;
  await mkdir(path.join(root, 'Album'));
  await writeFile(path.join(root, 'b.jpg'), '');
  library.forget(['.', 'Trips']);
  await library.listFolder('.');
  await library.listFolder('Trips');
  // Trips holds the same folders as before, so only the library's own folder is told of.
  expect(relisted).toEqual(['.']);
  await expect(library.folderSkeleton(['.'])).resolves.toEqual({
    folders: [
      ['Album', '.', 'Album'],
      ['Trips', '.', 'Trips'],
    ],
    listed: ['.'],
  });
});
