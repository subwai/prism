import { fakeFolder } from '#components/__tests__/fake-folder';
import { renderApp } from '#components/__tests__/render';
import { changed, tell } from '#data/__tests__/fixtures';
import type { FolderListing, FolderSkeleton, FolderSummary, PhotoEntry } from '@prism/shared';
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

/** The catalog of `nestedFolder` before it has read Album, so it knows nothing inside it. */
const ALBUM_UNREAD: FolderSkeleton = {
  folders: [
    ['Album', '.', 'Album'],
    ['Trips', '.', 'Trips'],
    ['Trips/Beach', 'Trips', 'Beach'],
  ],
  listed: ['.', 'Trips', 'Trips/Beach'],
};

test('a folder the catalog has not read shows no arrow until it is known to have folders inside', async () => {
  const api = nestedFolder();
  api.folderSkeleton.mockResolvedValue(ALBUM_UNREAD);
  const inspected = Promise.withResolvers<FolderSummary>();
  api.inspectFolder.mockReturnValue(inspected.promise);
  const { screen } = await renderApp({ api });
  const tree = screen.getByRole('tree', { name: 'Folders' });
  const album = tree.getByRole('treeitem', { name: 'Album' });
  await expect.element(album).toBeVisible();
  await expect.element(album).not.toHaveAttribute('aria-expanded');
  // The catalog knows Trips has folders inside, so it says so at once.
  await expect
    .element(tree.getByRole('treeitem', { name: 'Trips' }))
    .toHaveAttribute('aria-expanded', 'false');
  inspected.resolve({ covers: [], hasEntries: true, hasSubfolders: true });
  await expect.element(album).toHaveAttribute('aria-expanded', 'false');
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
    folders: [
      ['Trips/Beach', 'Trips', 'Beach'],
      ['Trips/Shore', 'Trips', 'Shore'],
    ],
    listed: ['Trips'],
  });
  tell(api, { changes: { changed: [changed(shore)], everything: false }, views: [] });
  await expect.element(tree.getByRole('treeitem', { name: 'Shore' })).toBeVisible();
  expect(api.folderSkeleton).toHaveBeenLastCalledWith(['Trips']);

  // The worker read Trips and found Beach gone, which no change on disk told of.
  api.folderSkeleton.mockResolvedValue({
    folders: [['Trips/Shore', 'Trips', 'Shore']],
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
