import { WorkerBackend } from '#photos/worker/backend';
import { PhotoLibrary } from '#photos/worker/library';
import type { FolderSummary } from '@prism/shared';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { expect, onTestFinished, test, vi } from 'vitest';

async function openLibrary() {
  const root = await mkdtemp(path.join(tmpdir(), 'folder-tiles-'));
  onTestFinished(() => rm(root, { force: true, recursive: true }));
  return root;
}

async function open(root: string) {
  const library = await PhotoLibrary.open(root);
  onTestFinished(() => library.close());
  return library;
}

/** The folder's own entries, which must all have been read. */
async function list(library: PhotoLibrary, directoryId: string) {
  const listing = await library.listFolder(directoryId);
  expect(listing.errors).toEqual([]);
  return listing.entries;
}

/**
 * The tile the catalog keeps of the folder `id` once the worker read it, as it is on show, as a
 * listing of the folder holding it has it.
 */
async function tileOf(library: PhotoLibrary, id: string) {
  await list(library, path.dirname(id));
  await library.readTile(id);
  const entries = await list(library, path.dirname(id));
  return entries.find((entry) => entry.id === id)?.summary;
}

function coverIds(summary: FolderSummary | undefined) {
  return summary?.covers.map((cover) => cover.id);
}

test('folders without photos of their own take covers from the first folder inside with any', async () => {
  const root = await openLibrary();
  await mkdir(path.join(root, 'top', 'a', 'deeper'), { recursive: true });
  await mkdir(path.join(root, 'top', 'b'));
  await writeFile(path.join(root, 'top', 'a', 'deeper', 'deepest.jpg'), '');
  await writeFile(path.join(root, 'top', 'b', 'shallow.jpg'), '');
  await writeFile(path.join(root, 'top', 'b', 'clip.mp4'), '');
  await mkdir(path.join(root, 'empty'));
  const library = await open(root);
  // The first folder by name with covers lends them, however deep they are, rather than the
  // shallowest folder with any.
  expect(await tileOf(library, 'top')).toEqual({
    covers: [expect.objectContaining({ id: path.join('top', 'a', 'deeper', 'deepest.jpg') })],
    hasEntries: true,
    hasSubfolders: true,
    read: true,
  });
  expect(await tileOf(library, 'empty')).toEqual({
    covers: [],
    hasEntries: false,
    hasSubfolders: false,
    read: true,
  });
  const lender = await tileOf(library, path.join('top', 'b'));
  expect(coverIds(lender)).toEqual([
    path.join('top', 'b', 'shallow.jpg'),
    path.join('top', 'b', 'clip.mp4'),
  ]);
});

test('folders of folders find covers past a wide layer of folders without photos', async () => {
  const root = await openLibrary();
  // A year of day folders: more folders a layer down than a cover search opens.
  for (let month = 1; month <= 12; month += 1) {
    for (let day = 1; day <= 25; day += 1) {
      await mkdir(path.join(root, '2024', `${month}`, `${day}`), { recursive: true });
    }
  }
  await writeFile(path.join(root, '2024', '1', '1', 'day.jpg'), '');
  const library = await open(root);
  expect(coverIds(await tileOf(library, '2024'))).toEqual([path.join('2024', '1', '1', 'day.jpg')]);
});

test('a tile read while its folder changed has what the folder holds once read again', async () => {
  const root = await openLibrary();
  await mkdir(path.join(root, 'top', 'a'), { recursive: true });
  const library = await open(root);
  const reading = library.readTile('top');
  library.forget(['top']);
  await reading;
  await writeFile(path.join(root, 'top', 'a', 'late.jpg'), '');
  library.forget(['top', path.join('top', 'a')]);
  expect(coverIds(await tileOf(library, 'top'))).toEqual([path.join('top', 'a', 'late.jpg')]);
});

test('a folder with photos of its own keeps them as covers', async () => {
  const root = await openLibrary();
  await mkdir(path.join(root, 'top', 'child'), { recursive: true });
  await writeFile(path.join(root, 'top', 'child', 'nested.jpg'), '');
  await writeFile(path.join(root, 'top', 'own.jpg'), '');
  const library = await open(root);
  expect(coverIds(await tileOf(library, 'top'))).toEqual([path.join('top', 'own.jpg')]);
});

test('a change deep inside a folder replaces the cover it took from there', async () => {
  const root = await openLibrary();
  await mkdir(path.join(root, 'top', 'a', 'deeper'), { recursive: true });
  await writeFile(path.join(root, 'top', 'a', 'deeper', 'first.jpg'), '');
  const library = await open(root);
  expect(coverIds(await tileOf(library, 'top'))).toHaveLength(1);
  await rm(path.join(root, 'top', 'a', 'deeper', 'first.jpg'));
  await library.describeChanges([
    {
      id: path.join('top', 'a', 'deeper', 'first.jpg'),
      parentId: path.join('top', 'a', 'deeper'),
    },
  ]);
  // The catalog passes the change up, with no read of the tile.
  await library.views.current();
  const [top] = await list(library, '.');
  expect(top?.summary?.covers).toEqual([]);
});

test("the worker reads each folder's tile once a session, and again after a refresh", async () => {
  const root = await openLibrary();
  await mkdir(path.join(root, 'a'));
  const library = await open(root);
  const backend = new WorkerBackend(library, path.join(root, 'cache'));
  const read = vi.spyOn(library, 'readTile').mockResolvedValue();
  await backend.readTiles(['a', 'a']);
  await backend.readTiles(['a']);
  expect(read).toHaveBeenCalledOnce();
  // Once that read is done.
  await setImmediate();
  backend.refresh();
  await backend.readTiles(['a']);
  expect(read).toHaveBeenCalledTimes(2);
});
