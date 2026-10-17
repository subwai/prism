import { openFolder, test } from './fixtures.ts';
import { describe, expect } from 'vitest';

describe('view mode', () => {
  test('the View menu switches between grid and filmstrip', async ({ app, page }) => {
    await openFolder(page);
    const toggle = () =>
      app.evaluate(({ BrowserWindow, Menu }) => {
        const item = Menu.getApplicationMenu()?.getMenuItemById('toggle-view');
        item?.click(undefined, BrowserWindow.getAllWindows()[0]);
        return item?.accelerator;
      });
    await expect(toggle()).resolves.toBe(process.platform === 'darwin' ? 'Cmd+G' : 'Ctrl+G');
    await page.getByRole('listbox', { name: 'Photo filmstrip' }).waitFor();
    await toggle();
    await page.getByRole('listbox', { name: 'Folder contents' }).waitFor();
  });
});
