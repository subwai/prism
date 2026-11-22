import { PhotoLibrary } from '#photos/worker/library';
import { decodeTreeListing, type TreeListing } from '@prism/shared';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, onTestFinished, test } from 'vitest';

async function openLibrary() {
  const root = await mkdtemp(path.join(tmpdir(), 'folder-skeleton-'));
  onTestFinished(() => rm(root, { force: true, recursive: true }));
  const library = PhotoLibrary.open(await realpath(root));
  onTestFinished(() => library.close());
  return { library, root };
}

test("the tree's folders come from the catalog, and reads tell whose subfolders changed", async () => {
  const { library, root } = await openLibrary();
  await mkdir(path.join(root, 'Trips', 'Beach'), { recursive: true });
  await writeFile(path.join(root, 'Trips', 'a.jpg'), '');
  const relisted: string[] = [];
  const retiled: string[] = [];
  library.onFoldersChanged(({ folders, tiles }) => {
    relisted.push(...folders);
    retiled.push(...tiles);
  });
  // Nothing is read yet, and asking reads nothing.
  await expect(library.wholeSkeleton().then(decodeTreeListing)).resolves.toEqual({
    covers: '',
    folders: [],
    root: [false, false, -1, false],
  });
  await library.readFolder('.');
  await library.readFolder('Trips');
  // Told for their subfolders, and apart, for the folders whose tiles changed.
  expect(new Set(relisted)).toEqual(new Set(['.', 'Trips']));
  expect(new Set(retiled)).toEqual(new Set(['.', 'Trips', 'Trips/Beach']));
  const skeleton = decodeTreeListing(await library.wholeSkeleton());
  // One set of covers, a line of its own.
  expect(JSON.parse(skeleton.covers)).toEqual([
    ['Trips/a.jpg', 'image', 0, expect.any(Number), expect.any(String)],
  ]);
  expect(skeleton).toEqual({
    covers: expect.stringMatching(/\n$/u),
    folders: [
      ['.', [['Trips', 'Trips', [true, true, 0, true]]]],
      ['Trips', [['Trips/Beach', 'Beach', [false, false, -1, false]]]],
    ],
    // The library's folder borrows Trips' covers.
    root: [true, true, 0, true],
  });

  relisted.length = 0;
  retiled.length = 0;
  await mkdir(path.join(root, 'Album'));
  await writeFile(path.join(root, 'b.jpg'), '');
  library.forget(['.', 'Trips']);
  await library.readFolder('.');
  await library.readFolder('Trips');
  // Trips holds the same folders as before, so only the library's own folder is told of, and
  // the library's folder's tile, which shows its own photo now, with Album's.
  expect(new Set(relisted)).toEqual(new Set(['.']));
  expect(new Set(retiled)).toEqual(new Set(['.', 'Album']));
  await expect(library.folderSkeleton(['.'])).resolves.toMatchObject({
    folders: [
      [
        '.',
        [
          ['Album', 'Album', [false, false, -1, false]],
          // Read, unlike Album.
          ['Trips', 'Trips', [true, true, 0, true]],
        ],
      ],
    ],
  });
});

test('a folder is told of once its subfolders are in the catalog, which the window reads then', async () => {
  const { library, root } = await openLibrary();
  await mkdir(path.join(root, 'Trips', 'Beach'), { recursive: true });
  const seen: Promise<TreeListing>[] = [];
  // The window reads a folder it hears of at once, from the catalog's reader.
  library.onFoldersChanged(({ folders }) => {
    if (folders.length > 0) {
      seen.push(library.folderSkeleton(folders));
    }
  });
  await library.readFolder('.');
  await expect.poll(() => seen.length).toBeGreaterThan(0);
  for (const skeleton of seen) {
    await expect(skeleton).resolves.toEqual({
      covers: '',
      folders: [['.', [['Trips', 'Trips', [false, false, -1, false]]]]],
      root: [true, true, -1, true],
    });
  }
});
