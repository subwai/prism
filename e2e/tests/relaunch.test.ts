import { answerFolderDialog, freshApp, relaunch, test } from '#support/fixtures';
import { clickMenuItem } from '#support/menus';
import { copyFile, mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, onTestFinished } from 'vitest';

// Each step is given this long, well inside the test's own timeout, so a wait that never resolves
// fails naming its locator rather than as the whole test timing out.
const STEP_MS = 10_000;

describe('reopening the app', () => {
  test.override('app', freshApp);

  test('shows the same folder, view, sort and open folders, in a window of the same size and place', async ({
    app,
    page,
    photos,
  }) => {
    page.setDefaultTimeout(STEP_MS);
    const folder = await mkdtemp(path.join(os.tmpdir(), 'e2e-relaunch-'));
    onTestFinished(() => rm(folder, { force: true, recursive: true }));
    await mkdir(path.join(folder, 'Trips', 'Beach'), { recursive: true });
    await mkdir(path.join(folder, 'Album', 'Kids'), { recursive: true });
    await copyFile(
      path.join(photos, 'landscape.jpg'),
      path.join(folder, 'Trips', 'Beach', 'landscape.jpg'),
    );
    await answerFolderDialog(app, folder);
    await page.getByRole('button', { name: 'Choose a folder' }).click();
    // A folder opened by hand in the tree, which the main process keeps for the folder. The
    // arrow keys move the tree's cursor, and leave the folder shown as it is.
    const tree = page.getByRole('tree', { name: 'Folders' });
    // Its arrow shows once the worker has read it, in the background, for its row.
    await tree.getByRole('treeitem', { expanded: false, name: 'Album' }).waitFor();
    await tree.focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowRight');
    await tree.getByRole('treeitem', { name: 'Kids' }).waitFor();
    // Into a folder the tree has not opened by hand.
    const contents = page.getByRole('listbox', { name: 'Folder contents' });
    await contents.getByRole('option', { name: 'Trips' }).dblclick();
    await contents.getByRole('option', { name: 'Beach' }).dblclick();
    await contents.getByRole('option', { name: 'landscape.jpg' }).waitFor();
    await page.getByRole('button', { name: 'Sort descending' }).click();
    await page.getByRole('button', { name: 'Sort ascending' }).waitFor();
    await clickMenuItem(app, 'toggle-view');
    await page.getByRole('listbox', { name: 'Photo filmstrip' }).waitFor();
    // oxlint-disable-next-line id-length -- Electron's Rectangle shape.
    const bounds = { height: 600, width: 900, x: 40, y: 80 };
    await app.evaluate(({ BrowserWindow }, set) => {
      BrowserWindow.getAllWindows()[0]?.setBounds(set);
    }, bounds);

    const again = await relaunch(app, folder, onTestFinished);
    again.page.setDefaultTimeout(STEP_MS);
    await again.page.getByRole('listbox', { name: 'Photo filmstrip' }).waitFor();
    const url = new URL(again.page.url());
    expect(url.pathname).toBe('/library/filmstrip');
    expect(url.searchParams.get('folder')).toMatch(/Beach$/u);
    expect(url.searchParams.get('order')).toBe('desc');
    await expect(
      again.page.getByRole('treeitem', { name: 'Beach' }).getAttribute('aria-selected'),
    ).resolves.toBe('true');
    await again.page.getByRole('treeitem', { name: 'Kids' }).waitFor();
    await expect(
      again.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getBounds()),
    ).resolves.toEqual(bounds);
  });

  // Only the real app shows this: the window remembers the tree's folders a moment after they
  // change, so quitting at once sends them as it goes, and the main process keeps them.
  test('remembers a folder opened just before quitting', async ({ app, page }) => {
    page.setDefaultTimeout(STEP_MS);
    const folder = await mkdtemp(path.join(os.tmpdir(), 'e2e-relaunch-'));
    onTestFinished(() => rm(folder, { force: true, recursive: true }));
    await mkdir(path.join(folder, 'Album', 'Kids'), { recursive: true });
    await answerFolderDialog(app, folder);
    await page.getByRole('button', { name: 'Choose a folder' }).click();
    const tree = page.getByRole('tree', { name: 'Folders' });
    await tree.getByRole('treeitem', { expanded: false, name: 'Album' }).waitFor();
    await tree.focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowRight');
    await tree.getByRole('treeitem', { name: 'Kids' }).waitFor();

    const again = await relaunch(app, folder, onTestFinished);
    await again.page.getByRole('treeitem', { name: 'Kids' }).waitFor({ timeout: STEP_MS });
  });

  // Only the real app shows this: the main process reopens the folder without looking for it,
  // and the worker opens its catalog without the disk, as for a share that is offline.
  test('opens a library whose folder was moved away, and says the folder no longer exists', async ({
    app,
    page,
  }) => {
    const folder = await mkdtemp(path.join(os.tmpdir(), 'e2e-relaunch-'));
    onTestFinished(() => rm(folder, { force: true, recursive: true }));
    await mkdir(path.join(folder, 'Trips'));
    await answerFolderDialog(app, folder);
    await page.getByRole('button', { name: 'Choose a folder' }).click();
    await page
      .getByRole('listbox', { name: 'Folder contents' })
      .getByRole('option', { name: 'Trips' })
      .waitFor();
    await rename(folder, `${folder}-away`);
    onTestFinished(() => rm(`${folder}-away`, { force: true, recursive: true }));

    const again = await relaunch(app, folder, onTestFinished);
    await again.page.getByRole('heading', { name: 'This folder no longer exists' }).waitFor();
    expect(new URL(again.page.url()).pathname).toMatch(/^\/library\//u);
  });
});
