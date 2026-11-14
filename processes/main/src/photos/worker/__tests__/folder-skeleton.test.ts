import { PhotoLibrary } from '#photos/worker/library';
import type { FolderSkeleton } from '@prism/shared';
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
  library.onRelisted((folderIds) => relisted.push(...folderIds));
  // Nothing is read yet, and asking reads nothing.
  await expect(library.folderSkeleton()).resolves.toEqual({ covers: [], folders: [], listed: [] });
  await library.listFolder('.');
  await library.listFolder('Trips');
  // Told for their subfolders, and for those subfolders' tiles, which may be the same folder.
  expect(new Set(relisted)).toEqual(new Set(['.', 'Trips']));
  await expect(library.folderSkeleton()).resolves.toEqual({
    covers: [[['Trips/a.jpg', 'image', 0, expect.any(Number), expect.any(String)]]],
    folders: [
      ['Trips/Beach', 'Trips', 'Beach', [false, false, -1]],
      ['Trips', '.', 'Trips', [true, true, 0]],
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
  expect(new Set(relisted)).toEqual(new Set(['.']));
  await expect(library.folderSkeleton(['.'])).resolves.toMatchObject({
    folders: [
      ['Album', '.', 'Album', [false, false, -1]],
      ['Trips', '.', 'Trips', [true, true, 0]],
    ],
    listed: ['.'],
  });
});

test('a folder is told of once its subfolders are in the catalog, which the window reads then', async () => {
  const { library, root } = await openLibrary();
  await mkdir(path.join(root, 'Trips', 'Beach'), { recursive: true });
  const seen: Promise<FolderSkeleton>[] = [];
  // The window reads a folder it hears of at once, from the catalog's reader.
  library.onRelisted((folderIds) => seen.push(library.folderSkeleton(folderIds)));
  await library.listFolder('.');
  await expect.poll(() => seen.length).toBeGreaterThan(0);
  for (const skeleton of seen) {
    await expect(skeleton).resolves.toEqual({
      covers: [],
      folders: [['Trips', '.', 'Trips', [false, false, -1]]],
      listed: ['.'],
    });
  }
});
