import { folder, launch, listed, sizeIn } from '#photos/worker/__tests__/launches';
import type { PhotoLibrary } from '#photos/worker/library';
import { emptyFilter } from '@prism/shared';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, vi } from 'vitest';

// Each folder's listing, as it is, so the tests see which happen.
vi.mock(import('#photos/worker/read-folder'), async (original) => {
  const actual = await original();
  return { ...actual, readFolder: vi.fn(actual.readFolder) };
});

/** Settles once the library next tells of a view, `viewId` if given, whose folders are all read. */
function viewRead(library: PhotoLibrary, viewId?: string) {
  return new Promise<void>((resolve) => {
    const stop = library.views.onView((state) => {
      if (!state.loading && (viewId ?? state.viewId) === state.viewId) {
        stop();
        resolve();
      }
    });
  });
}

/**
 * Opens a view of `directoryId`, as the gallery does, or of everything inside it, as the
 * filmstrip does, once its folders are read.
 */
async function view(library: PhotoLibrary, directoryId: string, recursive = false) {
  const read = viewRead(library);
  const { viewId } = await library.views.open({
    descending: false,
    directoryId,
    filter: emptyFilter(),
    recursive,
    search: '',
    show: 'all',
    sort: 'name',
    suggesting: false,
  });
  await read;
  return viewId;
}

test('a view of every folder reads only those that changed, and a refresh reads them all', async () => {
  const root = await folder('unchanged-');
  const catalog = await folder('unchanged-catalog-');
  await mkdir(path.join(root, 'Trips', 'Beach'), { recursive: true });
  await writeFile(path.join(root, 'Trips', 'a.jpg'), 'a');
  const first = launch(root, catalog);
  await first.checkEveryFolder();
  await first.close();

  await writeFile(path.join(root, 'Trips', 'a.jpg'), 'longer');
  await writeFile(path.join(root, 'Trips', 'Beach', 'b.jpg'), '');
  listed();
  const again = launch(root, catalog);
  const everything = await view(again, '.', true);
  // Its own folder is on show, so it is read in full.
  expect(listed()).toEqual(['.', 'Trips/Beach']);
  // As is a folder the window opens.
  await view(again, 'Trips');
  expect(listed()).toEqual(['Trips']);
  expect(await sizeIn(again, 'Trips/a.jpg')).toBe(6);

  await writeFile(path.join(root, 'Trips', 'a.jpg'), 'longer still');
  const refreshed = viewRead(again, everything);
  again.forget();
  await refreshed;
  expect(listed()).toEqual(['.', 'Trips', 'Trips/Beach']);
  expect(await sizeIn(again, 'Trips/a.jpg')).toBe(12);
});
