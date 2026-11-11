import { fakeFolder } from '#components/__tests__/fake-folder';
import { renderApp } from '#components/__tests__/render';
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
