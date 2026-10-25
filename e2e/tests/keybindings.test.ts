import { freshApp, openFolder, test } from '#support/fixtures';
import { existsSync } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ElectronApplication, Page } from 'playwright-core';
import { describe, expect } from 'vitest';

// The main process writes files after a round trip, which a busy machine slows down.
const WRITTEN = { timeout: 5000 };

/** Where the app reads `keybindings.json`, in this test's own profile. */
async function keybindingsFile(app: ElectronApplication) {
  const folder = await app.evaluate(({ app: electron }) => electron.getPath('userData'));
  return path.join(folder, 'keybindings.json');
}

function menuAccelerator(app: ElectronApplication, id: string) {
  return app.evaluate(
    ({ Menu }, item) => Menu.getApplicationMenu()?.getMenuItemById(item)?.accelerator ?? null,
    id,
  );
}

/** Clicks a menu item that opens a file, which the app answers as if an editor had opened it. */
async function clickFileMenuItem(app: ElectronApplication, id: string) {
  // The app sets its menu just before it opens the window.
  await app.firstWindow();
  await app.evaluate(({ BrowserWindow, Menu, shell }, item) => {
    // Opening would start an editor; this answers as if it had.
    shell.openPath = () => Promise.resolve('');
    Menu.getApplicationMenu()
      ?.getMenuItemById(item)
      ?.click(undefined, BrowserWindow.getAllWindows()[0]);
  }, id);
}

async function openPhoto(page: Page) {
  await openFolder(page);
  await page.getByRole('option', { name: 'landscape.jpg' }).click();
  await page.keyboard.press('Shift+Space');
  await page
    .getByRole('region', { name: 'Image preview' })
    .getByRole('img', { name: 'landscape.jpg' })
    .waitFor({ state: 'visible' });
}

describe('keybindings.json', () => {
  // Each test writes the rules the app keeps reading, so each launches the app afresh.
  test.override('app', freshApp);

  test('rules take effect as the file is saved, in keys and in the menu', async ({ app, page }) => {
    await openPhoto(page);
    await writeFile(
      await keybindingsFile(app),
      `// Mine
      [
        { "key": "n", "command": "next", "when": "viewerFocus" },
        { "key": "alt+o", "command": "openFolder" },
      ]`,
    );
    await expect.poll(() => menuAccelerator(app, 'open-folder')).toBe('Alt+O');
    await page.keyboard.press('n');
    await page
      .getByRole('region', { name: 'Image preview' })
      .getByRole('img', { name: 'portrait.jpg' })
      .waitFor({ state: 'visible' });
  });

  test('a file that does not parse is pointed out, and the keys keep working', async ({
    app,
    page,
  }) => {
    await openFolder(page);
    await writeFile(await keybindingsFile(app), '[{ "key": "n" "command": "next" }]');
    await page.getByText('keybindings.json: CommaExpected on line 1').waitFor();
    await page.getByRole('option', { name: 'landscape.jpg' }).click();
    await page.keyboard.press('Shift+Space');
    await page.getByRole('dialog').waitFor();
  });

  test('a rule that cannot be used is pointed out', async ({ app, page }) => {
    await openFolder(page);
    await writeFile(await keybindingsFile(app), '[{ "key": "n", "command": "nxt" }]');
    await page.getByText('keybindings.json: Rule 1: unknown command "nxt"').waitFor();
  });

  test('Keyboard Shortcuts… creates the file, with notes on writing rules', async ({ app }) => {
    const file = await keybindingsFile(app);
    expect(existsSync(file)).toBe(false);
    await clickFileMenuItem(app, 'keyboard-shortcuts');
    // The file exists a moment before what is written into it.
    await expect
      .poll(() => readFile(file, 'utf8').catch(() => ''), WRITTEN)
      .toContain('//   seekForward ');
  });

  test('Default Keyboard Shortcuts opens a read-only copy of the defaults', async ({ app }) => {
    const file = path.join(path.dirname(await keybindingsFile(app)), 'default-keybindings.jsonc');
    await clickFileMenuItem(app, 'default-keyboard-shortcuts');
    await expect
      .poll(() => readFile(file, 'utf8').catch(() => ''), WRITTEN)
      .toContain('{ "key": "shift+right", "command": "next", "when": "viewerFocus" }');
    // Readable by all, writable by nobody.
    expect(((await stat(file)).mode % 0o1000).toString(8)).toBe('444');
  });
});
