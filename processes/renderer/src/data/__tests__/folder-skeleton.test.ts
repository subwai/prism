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

test('changes to listings read the folders in them again, and rewrites do not', async () => {
  const { api, library } = fixture([], [trips, beach]);
  await library.tree.read();
  const photo: PhotoEntry = { id: 'Trips/a.jpg', kind: 'image', name: 'a.jpg', parentId: 'Trips' };
  const rewrite = changed(photo, { contentChanged: true, listingChanged: false });
  await library.applyChanges({ changed: [rewrite], everything: false }).read;
  expect(api.folderSkeleton).toHaveBeenCalledTimes(1);
  api.folderSkeleton.mockResolvedValueOnce({ covers: [], folders: [], listed: ['Trips'] });
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
