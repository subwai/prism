import { openFolder, test } from './fixtures.ts';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ElectronApplication, Page } from 'playwright-core';
import sharp from 'sharp';
import { describe, expect, onTestFinished } from 'vitest';

const REVEAL =
  (
    {
      darwin: 'Reveal in Finder',
      win32: 'Reveal in File Explorer'
    } as Partial<Record<NodeJS.Platform, string>>
  )[process.platform] ?? 'Open Containing Folder';

/** Native menus cannot be clicked from the page, so each one picks the item `label` at once. */
async function chooseMenuItem(app: ElectronApplication, label: string) {
  await app.evaluate(({ Menu, shell }, chosen) => {
    const state = globalThis as typeof globalThis & { revealed?: string[]; menus?: string[][] };
    state.revealed = [];
    state.menus = [];
    Menu.prototype.popup = function popup(options) {
      const items = this.items.filter((item) => item.type !== 'separator');
      state.menus?.push(items.map((item) => item.label));
      items.find((item) => item.label === chosen)?.click();
      options?.callback?.();
    };
    shell.showItemInFolder = (file) => {
      state.revealed?.push(file);
    };
  }, label);
  return () =>
    app.evaluate(() => {
      const state = globalThis as typeof globalThis & { revealed?: string[]; menus?: string[][] };
      return { menus: state.menus ?? [], revealed: state.revealed ?? [] };
    });
}

/** Opens a folder of its own, since renaming changes what is in it. */
async function openOwnFolder(app: ElectronApplication, page: Page) {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'e2e-rename-'));
  onTestFinished(() => rm(folder, { force: true, recursive: true }));
  await mkdir(path.join(folder, 'Trips'));
  await Promise.all(
    ['first.jpg', 'second.jpg', path.join('Trips', 'beach.jpg')].map((name) =>
      sharp({ create: { background: '#2a5d9f', channels: 3, height: 300, width: 400 } }).toFile(
        path.join(folder, name)
      )
    )
  );
  await app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [chosen] });
  }, folder);
  await openFolder(page);
  return { folder, grid: page.getByRole('listbox', { name: 'Folder contents' }) };
}

describe('right-click menu', () => {
  test('reveals a photo, and selects it, from the grid', async ({ app, page }) => {
    const menus = await chooseMenuItem(app, REVEAL);
    await openFolder(page);
    const option = page.getByRole('option', { name: 'portrait.jpg' });
    await option.click({ button: 'right' });
    await expect
      .poll(async () => (await menus()).revealed)
      .toEqual([expect.stringMatching(/portrait\.jpg$/u)]);
    expect((await menus()).menus).toEqual([['Rename…', REVEAL]]);
    await expect(option.getAttribute('aria-selected')).resolves.toBe('true');
  });

  test('reveals a folder from the sidebar', async ({ app, page }) => {
    const menus = await chooseMenuItem(app, REVEAL);
    await openFolder(page);
    await page.getByRole('treeitem').first().click({ button: 'right' });
    await expect.poll(async () => (await menus()).revealed).toHaveLength(1);
    // The open folder itself is renamed from its parent instead.
    expect((await menus()).menus).toEqual([[REVEAL]]);
  });
});

describe('renaming', () => {
  test('renames a photo, keeping its extension and its selection', async ({ app, page }) => {
    await chooseMenuItem(app, 'Rename…');
    const { folder, grid } = await openOwnFolder(app, page);
    await grid.getByRole('option', { name: 'first.jpg' }).click({ button: 'right' });
    const dialog = page.getByRole('dialog', { name: 'Rename first.jpg' });
    await dialog.waitFor();
    // Only the name before the extension starts selected, so typing replaces just that.
    await page.keyboard.type('sunset');
    await page.keyboard.press('Enter');
    await dialog.waitFor({ state: 'detached' });
    const renamed = grid.getByRole('option', { name: 'sunset.jpg' });
    await expect(renamed.getAttribute('aria-selected')).resolves.toBe('true');
    await expect(grid.getByRole('option', { name: 'first.jpg' }).count()).resolves.toBe(0);
    await expect(readdir(folder)).resolves.toEqual(['Trips', 'second.jpg', 'sunset.jpg']);
  });

  test('a name already taken keeps the dialog open and says why', async ({ app, page }) => {
    await chooseMenuItem(app, 'Rename…');
    const { folder, grid } = await openOwnFolder(app, page);
    await grid.getByRole('option', { name: 'first.jpg' }).click({ button: 'right' });
    const dialog = page.getByRole('dialog', { name: 'Rename first.jpg' });
    await dialog.getByRole('textbox', { name: 'Name' }).fill('second.jpg');
    await dialog.getByRole('button', { name: 'Rename' }).click();
    await dialog
      .getByRole('alert')
      .filter({ hasText: 'The name “second.jpg” is already taken.' })
      .waitFor();
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
    await expect(readdir(folder)).resolves.toEqual(['Trips', 'first.jpg', 'second.jpg']);
  });

  test('Escape closes the dialog as soon as it opens, renaming nothing', async ({ app, page }) => {
    await chooseMenuItem(app, 'Rename…');
    const { folder, grid } = await openOwnFolder(app, page);
    await grid.getByRole('option', { name: 'first.jpg' }).click({ button: 'right' });
    const dialog = page.getByRole('dialog', { name: 'Rename first.jpg' });
    await dialog.waitFor();
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
    await expect(readdir(folder)).resolves.toEqual(['Trips', 'first.jpg', 'second.jpg']);
  });

  test('renaming the open folder keeps it open under its new name', async ({ app, page }) => {
    await chooseMenuItem(app, 'Rename…');
    const { grid } = await openOwnFolder(app, page);
    const tree = page.getByRole('tree', { name: 'Folders' });
    await tree.getByRole('button', { exact: true, name: 'Trips' }).click();
    await grid.getByRole('option', { name: 'beach.jpg' }).waitFor();
    await tree.getByRole('treeitem', { name: /Trips/u }).click({ button: 'right' });
    await page.getByRole('textbox', { name: 'Name' }).fill('Holidays');
    await page.keyboard.press('Enter');
    await expect.poll(() => new URL(page.url()).searchParams.get('folder')).toBe('Holidays');
    await tree.getByRole('treeitem', { name: /Holidays/u, selected: true }).waitFor();
    await grid.getByRole('option', { name: 'beach.jpg' }).waitFor();
  });
});
