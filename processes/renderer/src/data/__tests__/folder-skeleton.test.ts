import { subfoldersIn } from '#data/folder-skeleton';
import { changed, child, fixture, removed, tell } from './fixtures.ts';
import type { PhotoEntry } from '@prism/shared';
import { expect, test } from 'vitest';

const trips: PhotoEntry = { ...child, id: 'Trips', name: 'Trips' };
const beach: PhotoEntry = {
  id: 'Trips/Beach',
  kind: 'directory',
  name: 'Beach',
  parentId: 'Trips',
};

test('the tree reads every folder once a session, with the folders it had open', async () => {
  const { api, library } = fixture([], [trips, beach]);
  api.openedFolders.mockResolvedValue([['Trips', true]]);
  await Promise.all([library.tree.read(), library.tree.read()]);
  expect(api.folderSkeleton).toHaveBeenCalledOnce();
  const state = library.tree.getSnapshot();
  expect(subfoldersIn(state, '.').map((folder) => folder.id)).toEqual(['Trips']);
  expect(subfoldersIn(state, 'Trips')).toEqual([beach]);
  expect(state.opened).toEqual(new Map([['Trips', true]]));
});

test('changes to folders read their parents again, and other changes do not', async () => {
  const { api, library } = fixture([], [trips, beach]);
  await library.tree.read();
  const photo: PhotoEntry = { id: 'Trips/a.jpg', kind: 'image', name: 'a.jpg', parentId: 'Trips' };
  await library.applyChanges({ changed: [changed(photo)], everything: false }).read;
  expect(api.folderSkeleton).toHaveBeenCalledTimes(1);
  api.folderSkeleton.mockResolvedValueOnce({ folders: [], listed: ['Trips'] });
  // A removal says nothing of what went, but the tree knew Beach as a folder.
  await library.applyChanges({ changed: [removed(beach), removed(photo)], everything: false }).read;
  expect(api.folderSkeleton).toHaveBeenLastCalledWith(['Trips']);
  expect(subfoldersIn(library.tree.getSnapshot(), 'Trips')).toEqual([]);
});

test('folders the worker found changed are read again, and a refresh reads them all', async () => {
  const { api, library } = fixture([], [trips, beach]);
  await library.tree.read();
  tell(api, { changes: null, folders: ['Trips', 'Trips'], views: [] });
  expect(api.folderSkeleton).toHaveBeenLastCalledWith(['Trips']);
  await library.refresh();
  // Every folder, rather than some.
  expect(api.folderSkeleton.mock.lastCall?.[0]).toBeUndefined();
});

test("a listing the window reads gives the tree that folder's subfolders", async () => {
  const { library } = fixture([
    { entries: [trips, child], error: null, errors: [], missing: false },
  ]);
  await library.tree.read();
  expect(library.tree.getSnapshot().listed.has('.')).toBe(true);
  expect(subfoldersIn(library.tree.getSnapshot(), '.')).toEqual([]);
  await library.directory('.');
  expect(subfoldersIn(library.tree.getSnapshot(), '.').map((folder) => folder.id)).toEqual([
    'Trips',
    child.id,
  ]);
});
