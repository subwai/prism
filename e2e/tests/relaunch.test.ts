import { freshApp, relaunch, test } from '#support/fixtures';
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, onTestFinished } from 'vitest';

describe('reopening the app', () => {
  test.override('app', freshApp);

  test('shows the folder it showed, as it showed it, in the window as it was', async ({
    app,
    page,
    photos,
  }) => {
    const folder = await mkdtemp(path.join(os.tmpdir(), 'e2e-relaunch-'));
    onTestFinished(() => rm(folder, { force: true, recursive: true }));
    await mkdir(path.join(folder, 'Trips', 'Beach'), { recursive: true });
    await copyFile(
      path.join(photos, 'landscape.jpg'),
      path.join(folder, 'Trips', 'Beach', 'landscape.jpg'),
    );
    await app.evaluate(({ dialog }, chosen) => {
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [chosen] });
    }, folder);
    await page.getByRole('button', { name: 'Choose a folder' }).click();
    // Into a folder the tree has not opened by hand.
    const contents = page.getByRole('listbox', { name: 'Folder contents' });
    await contents.getByRole('option', { name: 'Trips' }).dblclick();
    await contents.getByRole('option', { name: 'Beach' }).dblclick();
    await contents.getByRole('option', { name: 'landscape.jpg' }).waitFor();
    await page.getByRole('button', { name: 'Sort descending' }).click();
    await page.getByRole('button', { name: 'Sort ascending' }).waitFor();
    await app.evaluate(({ BrowserWindow, Menu }) => {
      Menu.getApplicationMenu()
        ?.getMenuItemById('toggle-view')
        ?.click(undefined, BrowserWindow.getAllWindows()[0]);
    });
    await page.getByRole('listbox', { name: 'Photo filmstrip' }).waitFor();
    // oxlint-disable-next-line id-length -- Electron's Rectangle shape.
    const bounds = { height: 600, width: 900, x: 40, y: 80 };
    await app.evaluate(({ BrowserWindow }, set) => {
      BrowserWindow.getAllWindows()[0]?.setBounds(set);
    }, bounds);

    const again = await relaunch(app, folder, onTestFinished);
    await again.page.getByRole('listbox', { name: 'Photo filmstrip' }).waitFor();
    const url = new URL(again.page.url());
    expect(url.pathname).toBe('/library/filmstrip');
    expect(url.searchParams.get('folder')).toMatch(/Beach$/u);
    expect(url.searchParams.get('order')).toBe('desc');
    await expect(
      again.page.getByRole('treeitem', { name: 'Beach' }).getAttribute('aria-selected'),
    ).resolves.toBe('true');
    await expect(
      again.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getBounds()),
    ).resolves.toEqual(bounds);
  });
});
