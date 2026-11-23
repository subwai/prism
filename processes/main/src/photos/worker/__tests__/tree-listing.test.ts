import { PhotoLibrary } from '#photos/worker/library/library';
import { type SerializedTreeListing, treeListingFromText } from '@prism/shared';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, onTestFinished, test } from 'vitest';

async function openLibrary() {
  const root = await mkdtemp(path.join(tmpdir(), 'tree-listing-'));
  onTestFinished(() => rm(root, { force: true, recursive: true }));
  const library = PhotoLibrary.open(await realpath(root));
  onTestFinished(() => library.close());
  return { library, root };
}

test("the tree's folders come from the catalog, and reads tell whose subfolders changed", async () => {
  const { library, root } = await openLibrary();
  await mkdir(path.join(root, 'Trips', 'Beach'), { recursive: true });
  await writeFile(path.join(root, 'Trips', 'a.jpg'), '');
  const changedFolders: string[] = [];
  const retiled: string[] = [];
  library.onFoldersChanged(({ folders, tiles }) => {
    changedFolders.push(...folders);
    retiled.push(...tiles);
  });
  // Nothing is read yet, and asking reads nothing.
  await expect(library.listWholeTree().then(treeListingFromText)).resolves.toEqual({
    covers: '',
    folders: [],
    root: [false, false, -1, false],
  });
  await library.readFolder('.');
  await library.readFolder('Trips');
  // Told for their subfolders, and apart, for the folders whose tiles changed.
  expect(new Set(changedFolders)).toEqual(new Set(['.', 'Trips']));
  expect(new Set(retiled)).toEqual(new Set(['.', 'Trips', 'Trips/Beach']));
  const treeListing = treeListingFromText(await library.listWholeTree());
  // One set of covers, a line of its own.
  expect(JSON.parse(treeListing.covers)).toEqual([
    ['Trips/a.jpg', 'image', 0, expect.any(Number), expect.any(String)],
  ]);
  expect(treeListing).toEqual({
    covers: expect.stringMatching(/\n$/u),
    folders: [
      ['.', [['Trips', 'Trips', [true, true, 0, true]]]],
      ['Trips', [['Trips/Beach', 'Beach', [false, false, -1, false]]]],
    ],
    // The library's folder borrows Trips' covers.
    root: [true, true, 0, true],
  });

  changedFolders.length = 0;
  retiled.length = 0;
  await mkdir(path.join(root, 'Album'));
  await writeFile(path.join(root, 'b.jpg'), '');
  library.forget(['.', 'Trips']);
  await library.readFolder('.');
  await library.readFolder('Trips');
  // Trips holds the same folders as before, so only the library's own folder is reported, and
  // the library's folder's tile, which shows its own photo now, with Album's.
  expect(new Set(changedFolders)).toEqual(new Set(['.']));
  expect(new Set(retiled)).toEqual(new Set(['.', 'Album']));
  await expect(library.listSubfolders(['.'])).resolves.toMatchObject({
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

test('a folder is reported once its subfolders are in the catalog, which the window reads then', async () => {
  const { library, root } = await openLibrary();
  await mkdir(path.join(root, 'Trips', 'Beach'), { recursive: true });
  const seen: Promise<SerializedTreeListing>[] = [];
  // The window reads a reported folder at once, from the catalog's reader.
  library.onFoldersChanged(({ folders }) => {
    if (folders.length > 0) {
      seen.push(library.listSubfolders(folders));
    }
  });
  await library.readFolder('.');
  await expect.poll(() => seen.length).toBeGreaterThan(0);
  for (const treeListing of seen) {
    await expect(treeListing).resolves.toEqual({
      covers: '',
      folders: [['.', [['Trips', 'Trips', [false, false, -1, false]]]]],
      root: [true, true, -1, true],
    });
  }
});
