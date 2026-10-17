import { openFolder, test } from './fixtures.ts';
import type { ElectronApplication } from 'playwright-core';
import { describe, expect } from 'vitest';

/** Native menus cannot be clicked from the page, so each one picks its first item at once. */
async function chooseFirstMenuItem(app: ElectronApplication) {
  await app.evaluate(({ Menu, shell }) => {
    const state = globalThis as typeof globalThis & { revealed?: string[]; labels?: string[] };
    state.revealed = [];
    state.labels = [];
    Menu.prototype.popup = function popup() {
      state.labels?.push(this.items[0]?.label ?? '');
      this.items[0]?.click();
    };
    shell.showItemInFolder = (file) => {
      state.revealed?.push(file);
    };
  });
  return () =>
    app.evaluate(() => {
      const state = globalThis as typeof globalThis & { revealed?: string[]; labels?: string[] };
      return { labels: state.labels ?? [], revealed: state.revealed ?? [] };
    });
}

const LABELS: Partial<Record<NodeJS.Platform, string>> = {
  darwin: 'Reveal in Finder',
  win32: 'Reveal in File Explorer'
};

describe('right-click menu', () => {
  test('reveals a photo, and selects it, from the grid', async ({ app, page }) => {
    const menus = await chooseFirstMenuItem(app);
    await openFolder(page);
    const option = page.getByRole('option', { name: 'portrait.jpg' });
    await option.click({ button: 'right' });
    await expect
      .poll(async () => (await menus()).revealed)
      .toEqual([expect.stringMatching(/portrait\.jpg$/u)]);
    expect((await menus()).labels).toEqual([LABELS[process.platform] ?? 'Open Containing Folder']);
    await expect(option.getAttribute('aria-selected')).resolves.toBe('true');
  });

  test('reveals a folder from the sidebar', async ({ app, page }) => {
    const menus = await chooseFirstMenuItem(app);
    await openFolder(page);
    await page.getByRole('treeitem').first().click({ button: 'right' });
    await expect.poll(async () => (await menus()).revealed).toHaveLength(1);
  });
});
