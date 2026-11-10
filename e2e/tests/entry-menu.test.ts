import { openFolder, test } from '#support/fixtures';
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
      win32: 'Reveal in File Explorer',
    } as Partial<Record<NodeJS.Platform, string>>
  )[process.platform] ?? 'Open Containing Folder';

type MenuState = typeof globalThis & {
  copied?: string[];
  revealed?: string[];
  menus?: string[][];
  /** Where each menu opened, if not at the pointer. */
  positions?: ({ left: number; top: number } | null)[];
};

/** Native menus cannot be clicked from the page, so each one picks the item `label` at once. */
async function chooseMenuItem(app: ElectronApplication, label: string) {
  await app.evaluate(({ clipboard, Menu, shell }, chosen) => {
    const state = globalThis as MenuState;
    state.copied = [];
    state.revealed = [];
    state.menus = [];
    state.positions = [];
    Menu.prototype.popup = function popup(options) {
      const items = this.items.filter((item) => item.type !== 'separator');
      state.menus?.push(items.map((item) => item.label));
      state.positions?.push(
        options?.x === undefined || options.y === undefined
          ? null
          : { left: options.x, top: options.y },
      );
      items.find((item) => item.label === chosen)?.click();
      options?.callback?.();
    };
    shell.showItemInFolder = (file) => {
      state.revealed?.push(file);
    };
    // Stubbed so a test never overwrites what the user has copied.
    clipboard.writeText = (text) => {
      state.copied?.push(text);
      return Promise.resolve();
    };
  }, label);
  return () =>
    app.evaluate(() => {
      const state = globalThis as MenuState;
      return {
        copied: state.copied ?? [],
        menus: state.menus ?? [],
        positions: state.positions ?? [],
        revealed: state.revealed ?? [],
      };
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
        path.join(folder, name),
      ),
    ),
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
    expect((await menus()).menus).toEqual([['Rename…', REVEAL, 'Copy Path']]);
    await expect(option.getAttribute('aria-selected')).resolves.toBe('true');
  });

  test('copies the path of a photo', async ({ app, page }) => {
    const menus = await chooseMenuItem(app, 'Copy Path');
    await openFolder(page);
    await page.getByRole('option', { name: 'portrait.jpg' }).click({ button: 'right' });
    await expect
      .poll(async () => (await menus()).copied)
      .toEqual([expect.stringMatching(/portrait\.jpg$/u)]);
  });

  test('opens from the keyboard for the selection, below it', async ({ app, page }) => {
    const menus = await chooseMenuItem(app, REVEAL);
    await openFolder(page);
    const grid = page.getByRole('listbox', { name: 'Folder contents' });
    const option = grid.getByRole('option', { name: 'portrait.jpg' });
    await option.click();
    await page.keyboard.press('Shift+F10');
    await expect
      .poll(async () => (await menus()).revealed)
      .toEqual([expect.stringMatching(/portrait\.jpg$/u)]);
    const box = await option.evaluate((element) => {
      const { bottom, left } = element.getBoundingClientRect();
      return { bottom, left };
    });
    expect((await menus()).positions).toEqual([
      { left: Math.round(box.left), top: Math.round(box.bottom) },
    ]);
  });

  test('scrolls the selection back into view to open it below it', async ({ app, page }) => {
    const menus = await chooseMenuItem(app, REVEAL);
    // A small window and large thumbnails, so the grid scrolls.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(740, 520));
    await openFolder(page);
    // Two columns of cards, each shorter than the grid, in three rows that are not.
    await page
      .getByRole('slider', { name: 'Thumbnail size' })
      .evaluate((slider: HTMLInputElement) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
          slider,
          '200',
        );
        slider.dispatchEvent(new Event('input', { bubbles: true }));
      });
    const grid = page.getByRole('listbox', { name: 'Folder contents' });
    const option = grid.getByRole('option').first();
    await option.click();
    await grid.evaluate((element) => element.scrollTo({ top: element.scrollHeight }));
    const inView = () =>
      option.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const list = element.closest('[role="listbox"]')?.getBoundingClientRect();
        return list !== undefined && box.top >= list.top && box.bottom <= list.bottom;
      });
    await expect.poll(inView).toBe(false);
    await page.keyboard.press('Shift+F10');
    await expect.poll(async () => (await menus()).revealed).toHaveLength(1);
    await expect(inView()).resolves.toBe(true);
    const box = await option.evaluate((element) => {
      const { bottom, left } = element.getBoundingClientRect();
      return { bottom, left };
    });
    expect((await menus()).positions).toEqual([
      { left: Math.round(box.left), top: Math.round(box.bottom) },
    ]);
  });

  test('opens from the keyboard in the sidebar', async ({ app, page }) => {
    const menus = await chooseMenuItem(app, REVEAL);
    await openFolder(page);
    await page.getByRole('tree', { name: 'Folders' }).focus();
    await page.keyboard.press('Shift+F10');
    await expect.poll(async () => (await menus()).revealed).toHaveLength(1);
    expect((await menus()).positions).toEqual([expect.objectContaining({})]);
  });

  test('reveals a folder from the sidebar', async ({ app, page }) => {
    const menus = await chooseMenuItem(app, REVEAL);
    await openFolder(page);
    await page.getByRole('treeitem').first().click({ button: 'right' });
    await expect.poll(async () => (await menus()).revealed).toHaveLength(1);
    // The open folder itself is renamed from its parent instead.
    expect((await menus()).menus).toEqual([[REVEAL, 'Copy Path']]);
  });
});

describe('renaming', () => {
  test('renames a photo, keeping its extension and its selection', async ({ app, page }) => {
    await chooseMenuItem(app, 'Rename…');
    const { folder, grid } = await openOwnFolder(app, page);
    await grid.getByRole('option', { name: 'first.jpg' }).click({ button: 'right' });
    const dialog = page.getByRole('dialog', { name: 'Rename “first.jpg”' });
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
    const dialog = page.getByRole('dialog', { name: 'Rename “first.jpg”' });
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
    const dialog = page.getByRole('dialog', { name: 'Rename “first.jpg”' });
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
