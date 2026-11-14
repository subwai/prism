import { fakeFolder } from '#components/__tests__/fake-folder';
import { renderApp } from '#components/__tests__/render';
import { changed, tell } from '#data/__tests__/fixtures';
import type { FolderListing, FolderSkeleton, PhotoEntry } from '@prism/shared';
import { expect, test } from 'vitest';
import { userEvent } from 'vitest/browser';

const photo = (name: string) => ({ color: '#2a5d9f', height: 300, name, width: 400 });

/** A folder with a folder in each of two folders, so each opens on its own. */
function nestedFolder() {
  return fakeFolder([
    { children: [{ children: [photo('a.jpg')], name: 'Beach' }], name: 'Trips' },
    { children: [{ children: [photo('b.jpg')], name: 'Kids' }], name: 'Album' },
  ]);
}

/** The folders whose tiles the window had the worker read. */
function tilesRead(api: ReturnType<typeof fakeFolder>) {
  return api.attend.mock.calls.flatMap(([{ tiles }]) => tiles);
}

/** The catalog of `nestedFolder` before it has read Album, so it knows nothing inside it. */
const ALBUM_UNREAD: FolderSkeleton = {
  covers: [],
  folders: [
    ['Album', '.', 'Album', null],
    ['Trips', '.', 'Trips', null],
    ['Trips/Beach', 'Trips', 'Beach', null],
  ],
  listed: ['.', 'Trips', 'Trips/Beach'],
};

test('a folder the catalog has not read shows no arrow until it is known to have folders inside', async () => {
  const api = nestedFolder();
  api.folderSkeleton.mockResolvedValue(ALBUM_UNREAD);
  // The catalog lists Album as it knows it: with nothing inside, as nothing was read there.
  let albumRead = false;
  const list = api.listFolder.getMockImplementation();
  api.listFolder.mockImplementation(async (id) => {
    const listing = await (list?.(id) ?? Promise.reject(new Error(id)));
    const at = listing.entries.findIndex((entry) => entry.id === 'Album');
    const album = listing.entries[at];
    if (albumRead || !album) {
      return listing;
    }
    const unread = { covers: [], hasEntries: false, hasSubfolders: false, read: false };
    return { ...listing, entries: listing.entries.with(at, { ...album, summary: unread }) };
  });
  const { screen } = await renderApp({ api });
  const tree = screen.getByRole('tree', { name: 'Folders' });
  const album = tree.getByRole('treeitem', { name: 'Album' });
  await expect.element(album).toBeVisible();
  await expect.element(album).not.toHaveAttribute('aria-expanded');
  // The catalog knows Trips has folders inside, so it says so at once.
  await expect
    .element(tree.getByRole('treeitem', { name: 'Trips' }))
    .toHaveAttribute('aria-expanded', 'false');
  // On show and unread, Album has the worker read it in the background, which answers nothing:
  // the worker tells of the folder holding it once Album's row has what it found.
  await expect.poll(() => tilesRead(api)).toContain('Album');
  albumRead = true;
  api.folderSkeleton.mockResolvedValue({
    ...ALBUM_UNREAD,
    folders: [['Album', '.', 'Album', [true, true, -1]], ...ALBUM_UNREAD.folders.slice(1)],
  });
  tell(api, { changes: null, folders: ['.'], views: [] });
  await expect.element(album).toHaveAttribute('aria-expanded', 'false');
});

test("folders' tiles and tree rows show their covers and arrows from their rows, asking nothing of each", async () => {
  const api = nestedFolder();
  const { screen } = await renderApp({ api });
  const tree = screen.getByRole('tree', { name: 'Folders' });
  const trips = tree.getByRole('treeitem', { name: 'Trips' });
  await expect.element(trips).toHaveAttribute('aria-expanded', 'false');
  // Trips has no photos of its own, so it shows Beach's, and so does its tile in the grid.
  await expect.poll(() => trips.element().querySelector('img')).not.toBeNull();
  const tile = screen.getByRole('option', { name: 'Trips' });
  await expect.poll(() => tile.element().querySelector('img')).not.toBeNull();
  // Every folder on show is read to the end and has covers, so none is read again for its tile,
  // and no folder's listing is asked for but the one the grid shows.
  expect(tilesRead(api)).toEqual([]);
  expect(api.listFolder.mock.calls.map(([id]) => id)).not.toContain('Trips');
});

test('the tree shows the folders the catalog knows, and opens them without asking the worker', async () => {
  const api = nestedFolder();
  api.openedFolders.mockResolvedValue([['Trips', true]]);
  // Never read, as folders on a share that takes its time.
  const { promise: unread } = Promise.withResolvers<FolderListing>();
  const list = api.listFolder.getMockImplementation();
  api.listFolder.mockImplementation((id) =>
    id === '.' ? (list?.(id) ?? Promise.reject(new Error(id))) : unread,
  );
  const { screen } = await renderApp({ api });
  const tree = screen.getByRole('tree', { name: 'Folders' });
  await expect.element(tree.getByRole('treeitem', { name: 'Beach' })).toBeVisible();
  await tree.getByRole('treeitem', { name: 'Album' }).click();
  // The click opens Album's view too. Waiting for it to land lets its view transition finish,
  // which the end of the test would otherwise cut off, and time out during the next one.
  await expect.element(screen.getByRole('heading', { name: 'Album' })).toBeInTheDocument();
  await userEvent.keyboard('{ArrowRight}');
  await expect.element(tree.getByRole('treeitem', { name: 'Kids' })).toBeVisible();
  expect(api.listFolder.mock.calls.map(([id]) => id)).not.toContain('Album');
  expect(api.listFolder.mock.calls.map(([id]) => id)).not.toContain('Trips');
});

test('an open folder the catalog has not read is read at once, and shows its folders then', async () => {
  const api = nestedFolder();
  api.folderSkeleton.mockResolvedValue(ALBUM_UNREAD);
  api.openedFolders.mockResolvedValue([['Album', true]]);
  const { screen } = await renderApp({ api });
  const tree = screen.getByRole('tree', { name: 'Folders' });
  await expect.element(tree.getByRole('treeitem', { name: 'Kids' })).toBeVisible();
  expect(api.listFolder).toHaveBeenCalledWith('Album');
});

test('expanding all opens every folder the catalog knows at once, and collapsing closes them', async () => {
  const api = nestedFolder();
  const { screen } = await renderApp({ api });
  const tree = screen.getByRole('tree', { name: 'Folders' });
  await expect.element(tree.getByRole('treeitem', { name: 'Album' })).toBeVisible();
  const asked = api.listFolder.mock.calls.length;
  await screen.getByRole('button', { name: 'Expand all folders' }).click();
  await expect.element(tree.getByRole('treeitem', { name: 'Beach' })).toBeVisible();
  await expect.element(tree.getByRole('treeitem', { name: 'Kids' })).toBeVisible();
  expect(api.listFolder).toHaveBeenCalledTimes(asked);
  await screen.getByRole('button', { name: 'Collapse all folders' }).click();
  await expect.element(tree.getByRole('treeitem', { name: 'Kids' })).not.toBeInTheDocument();
  await expect.element(tree.getByRole('treeitem', { name: 'Beach' })).not.toBeInTheDocument();
});

test("folders added, removed or found on disk read their folder's subfolders again", async () => {
  const api = nestedFolder();
  api.openedFolders.mockResolvedValue([['Trips', true]]);
  const { screen } = await renderApp({ api });
  const tree = screen.getByRole('tree', { name: 'Folders' });
  await expect.element(tree.getByRole('treeitem', { name: 'Beach' })).toBeVisible();

  const shore: PhotoEntry = {
    id: 'Trips/Shore',
    kind: 'directory',
    name: 'Shore',
    parentId: 'Trips',
  };
  api.folderSkeleton.mockResolvedValue({
    covers: [],
    folders: [
      ['Trips/Beach', 'Trips', 'Beach', null],
      ['Trips/Shore', 'Trips', 'Shore', null],
    ],
    listed: ['Trips'],
  });
  tell(api, { changes: { changed: [changed(shore)], everything: false }, views: [] });
  await expect.element(tree.getByRole('treeitem', { name: 'Shore' })).toBeVisible();
  expect(api.folderSkeleton).toHaveBeenLastCalledWith(['Trips']);

  // The worker read Trips and found Beach gone, which no change on disk told of.
  api.folderSkeleton.mockResolvedValue({
    covers: [],
    folders: [['Trips/Shore', 'Trips', 'Shore', null]],
    listed: ['Trips'],
  });
  tell(api, { changes: null, folders: ['Trips'], views: [] });
  await expect.element(tree.getByRole('treeitem', { name: 'Beach' })).not.toBeInTheDocument();
  await expect.element(tree.getByRole('treeitem', { name: 'Shore' })).toBeVisible();
});

// The main process keeps them in a file for the folder, which the end-to-end relaunch test covers.
test('the tree opens the folders it had open, and remembers those opened by hand', async () => {
  const api = nestedFolder();
  api.openedFolders.mockResolvedValue([['Trips', true]]);
  const { screen } = await renderApp({ api });
  const tree = screen.getByRole('tree', { name: 'Folders' });
  await expect.element(tree.getByRole('treeitem', { name: 'Beach' })).toBeVisible();
  await expect
    .element(tree.getByRole('treeitem', { name: 'Album' }))
    .toHaveAttribute('aria-expanded', 'false');
  await tree.getByRole('treeitem', { name: 'Album' }).click();
  await userEvent.keyboard('{ArrowRight}');
  await expect.element(tree.getByRole('treeitem', { name: 'Kids' })).toBeVisible();
  expect(api.rememberOpenedFolders).toHaveBeenLastCalledWith('test', [
    ['Trips', true],
    ['Album', true],
  ]);
});
