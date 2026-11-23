import { openFolder, test } from '#support/fixtures';
import { clickMenuItem } from '#support/menus';
import { describe, expect } from 'vitest';

describe('view mode', () => {
  test('the View menu steps through the grid, filmstrip and reader', async ({ app, page }) => {
    await openFolder(page);
    const toggle = () => clickMenuItem(app, 'toggle-view');
    await expect(toggle()).resolves.toBe(process.platform === 'darwin' ? 'Cmd+G' : 'Ctrl+G');
    await page.getByRole('listbox', { name: 'Photo filmstrip' }).waitFor();
    await toggle();
    await page.getByRole('region', { name: 'Pages' }).waitFor();
    await toggle();
    await page.getByRole('listbox', { name: 'Folder contents' }).waitFor();
  });
});
