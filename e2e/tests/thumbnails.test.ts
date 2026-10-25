import { openFolder, test } from '#support/fixtures';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect } from 'vitest';

describe('thumbnail cache', () => {
  test('resetting it from the File menu makes the thumbnails again', async ({ app, page }) => {
    await openFolder(page);
    const tile = page.getByRole('option', { name: 'landscape.jpg' }).locator('img');
    await tile.waitFor();
    const directory = path.join(
      await app.evaluate(({ app: electron }) => electron.getPath('userData')),
      'photo-thumbnails-v1'
    );
    const before = (await stat(directory)).birthtimeMs;

    await app.evaluate(({ BrowserWindow, Menu }) => {
      Menu.getApplicationMenu()
        ?.getMenuItemById('reset-thumbnail-cache')
        ?.click(undefined, BrowserWindow.getAllWindows()[0]);
    });

    // A new folder, filled again with the thumbnails on screen.
    await expect
      .poll(async () => {
        const info = await stat(directory).catch(() => null);
        const files = info ? await readdir(directory) : [];
        return Boolean(
          info && info.birthtimeMs > before && files.some((file) => file.endsWith('.webp'))
        );
      })
      .toBe(true);
    await expect
      .poll(() => tile.evaluate((image: HTMLImageElement) => image.naturalWidth))
      .toBeGreaterThan(0);
  });
});
