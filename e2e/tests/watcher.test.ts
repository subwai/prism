import { test } from '#support/fixtures';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ElectronApplication, Page } from 'playwright-core';
import sharp from 'sharp';
import { describe, expect, onTestFinished } from 'vitest';

function photo(file: string, background: string, width = 400) {
  return sharp({ create: { background, channels: 3, height: 300, width } }).toFile(file);
}

/** Opens a folder of its own, since these tests change what is in it. */
async function openOwnFolder(app: ElectronApplication, page: Page) {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'e2e-watch-'));
  onTestFinished(() => rm(folder, { force: true, recursive: true }));
  await photo(path.join(folder, 'first.jpg'), '#2a5d9f');
  await app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [chosen] });
  }, folder);
  await page.getByRole('button', { name: 'Choose a folder' }).click();
  const grid = page.getByRole('listbox', { name: 'Folder contents' });
  await grid.getByRole('option', { name: 'first.jpg' }).waitFor();
  return { folder, grid };
}

describe('folder watching', () => {
  test('shows photos added to the folder and drops removed ones', async ({ app, page }) => {
    const { folder, grid } = await openOwnFolder(app, page);
    await photo(path.join(folder, 'second.jpg'), '#8a6d2f');
    await grid.getByRole('option', { name: 'second.jpg' }).waitFor();

    await rm(path.join(folder, 'first.jpg'));
    await grid.getByRole('option', { name: 'first.jpg' }).waitFor({ state: 'detached' });
    await expect(grid.getByRole('option').count()).resolves.toBe(1);
  });

  test('a rewritten photo gets a new thumbnail', async ({ app, page }) => {
    const { folder, grid } = await openOwnFolder(app, page);
    const thumbnail = grid.getByRole('option', { name: 'first.jpg' }).locator('img');
    await thumbnail.waitFor();
    const before = await thumbnail.getAttribute('src');
    await photo(path.join(folder, 'first.jpg'), '#3f8a4f');
    await expect.poll(() => thumbnail.getAttribute('src'), { timeout: 10_000 }).not.toBe(before);
  });

  test('the open photo updates when it is rewritten', async ({ app, page }) => {
    const { folder, grid } = await openOwnFolder(app, page);
    await grid.getByRole('option', { name: 'first.jpg' }).click();
    await page.keyboard.press('Shift+Space');
    const shown = page.getByRole('region', { name: 'Image preview' }).getByRole('img', {
      name: 'first.jpg',
    });
    await shown.waitFor({ state: 'visible' });
    await photo(path.join(folder, 'first.jpg'), '#3f8a4f', 600);
    await expect
      .poll(() => shown.evaluate((image: HTMLImageElement) => image.naturalWidth), {
        timeout: 10_000,
      })
      .toBe(600);
  });

  test('a new subfolder appears in the sidebar', async ({ app, page }) => {
    const { folder } = await openOwnFolder(app, page);
    await mkdir(path.join(folder, 'Trips'));
    await page.getByRole('tree', { name: 'Folders' }).getByText('Trips').waitFor();
  });
});
