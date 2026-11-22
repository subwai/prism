import { subfoldersIn } from '#data/folder-skeleton';
import { changed, child, fixture, removed, tell } from './fixtures.ts';
import { skeletonOf } from './skeletons.ts';
import { type FolderSkeleton, type PhotoEntry, skeletonToText } from '@prism/shared';
import { expect, test, vi } from 'vitest';

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
  expect(api.wholeSkeleton).toHaveBeenCalledOnce();
  const state = library.tree.getSnapshot();
  expect(subfoldersIn(state, '.').map((folder) => folder.id)).toEqual(['Trips']);
  expect(subfoldersIn(state, 'Trips')).toEqual([beach]);
  expect(state.opened).toEqual(new Map([['Trips', true]]));
});

test('the tree remembers the folders it has open once they stop changing', async () => {
  vi.useFakeTimers();
  try {
    const { api, library } = fixture([], [trips, beach]);
    await library.tree.read();
    library.tree.setOpened(new Map([['Trips', true]]));
    library.tree.setOpened(new Map([['Trips/Beach', true]]));
    expect(library.tree.getSnapshot().opened).toEqual(new Map([['Trips/Beach', true]]));
    expect(api.rememberOpenedFolders).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();
    expect(api.rememberOpenedFolders).toHaveBeenCalledExactlyOnceWith('test', [
      ['Trips/Beach', true],
    ]);
  } finally {
    vi.useRealTimers();
  }
});

test('changes to listings read the folders in them again, and rewrites do not', async () => {
  const { api, library } = fixture([], [trips, beach]);
  await library.tree.read();
  const photo: PhotoEntry = { id: 'Trips/a.jpg', kind: 'image', name: 'a.jpg', parentId: 'Trips' };
  const rewrite = changed(photo, { contentChanged: true, listingChanged: false });
  await library.applyChanges({ changed: [rewrite], everything: false }).read;
  expect(api.folderSkeleton).not.toHaveBeenCalled();
  api.folderSkeleton.mockResolvedValueOnce(skeletonOf([]));
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
  expect(api.wholeSkeleton).toHaveBeenCalledTimes(2);
});

test('folders whose tiles changed are read again in place, and listings only when next used', async () => {
  const { api, library } = fixture([], [trips, beach]);
  await library.tree.read();
  for (const id of ['.', 'Trips']) {
    await library.directory(id);
  }
  api.listFolder.mockClear();
  api.folderTiles.mockResolvedValueOnce(
    skeletonOf(
      [
        ['Trips/Beach', 'Trips', 'Beach', [true, false, -1, true]],
        // One the tree has yet to hear of comes with its folder's subfolders instead.
        ['Trips/Cove', 'Trips', 'Cove', [false, false, -1, false]],
      ],
      { root: [true, true, -1, true] },
    ),
  );
  tell(api, { changes: null, tiles: ['Trips/Beach'], views: [] });
  await expect
    .poll(() => subfoldersIn(library.tree.getSnapshot(), 'Trips'))
    .toEqual([
      {
        ...beach,
        summary: expect.objectContaining({
          covers: [],
          hasEntries: true,
          hasSubfolders: false,
          read: true,
        }),
      },
    ]);
  expect(api.folderTiles).toHaveBeenCalledWith(['Trips/Beach']);
  expect(api.folderSkeleton).not.toHaveBeenCalled();
  expect(library.tree.getSnapshot().root).toMatchObject({ hasEntries: true, read: true });
  // Trips' listing shows Beach's tile, so it is read again once used; the library's is not.
  expect(api.listFolder).not.toHaveBeenCalled();
  for (const id of ['.', 'Trips']) {
    await library.directory(id);
  }
  expect(api.listFolder.mock.calls).toEqual([['Trips']]);
});

test('tiles read while the subfolders they belong to were read land on those subfolders', async () => {
  const { api, library } = fixture([], [trips]);
  api.wholeSkeleton.mockResolvedValueOnce(skeletonToText(skeletonOf([])));
  await library.tree.read();
  const unread = skeletonOf([['Trips', '.', 'Trips', [false, false, -1, false]]]);
  const read = skeletonOf([['Trips', '.', 'Trips', [true, false, -1, true]]], {
    root: [true, true, -1, true],
  });
  // The tiles answer last, once the subfolders read meanwhile put Trips in the tree.
  const tiles = Promise.withResolvers<FolderSkeleton>();
  api.folderSkeleton.mockResolvedValueOnce(unread);
  api.folderTiles.mockReturnValueOnce(tiles.promise);
  tell(api, { changes: null, folders: ['.'], tiles: ['Trips'], views: [] });
  await expect
    .poll(() => subfoldersIn(library.tree.getSnapshot(), '.').map((folder) => folder.id))
    .toEqual(['Trips']);
  tiles.resolve(read);
  await expect
    .poll(() => subfoldersIn(library.tree.getSnapshot(), '.')[0]?.summary)
    .toMatchObject({ covers: [], hasEntries: true, hasSubfolders: false, read: true });
});
