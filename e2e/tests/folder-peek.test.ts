import { test } from '#support/fixtures';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ElectronApplication, Page } from 'playwright-core';
import sharp from 'sharp';
import { describe, expect, onTestFinished } from 'vitest';

function photo(file: string, background: string) {
  return sharp({ create: { background, channels: 3, height: 300, width: 400 } }).toFile(file);
}

/** A folder with a subfolder inside a subfolder, opened in the grid. */
async function openNestedFolder(app: ElectronApplication, page: Page) {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'e2e-peek-'));
  onTestFinished(() => rm(folder, { force: true, recursive: true }));
  await mkdir(path.join(folder, 'Trips', 'Beach'), { recursive: true });
  await Promise.all([
    photo(path.join(folder, 'Trips', 'a.jpg'), '#2a5d9f'),
    photo(path.join(folder, 'Trips', 'b.jpg'), '#8a6d2f'),
    photo(path.join(folder, 'Trips', 'Beach', 'c.jpg'), '#3f8a4f'),
    photo(path.join(folder, 'Trips', 'Beach', 'd.jpg'), '#9f2a5d'),
  ]);
  await app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [chosen] });
  }, folder);
  await page.getByRole('button', { name: 'Choose a folder' }).click();
  await page
    .getByRole('listbox', { name: 'Folder contents' })
    .getByRole('option', { name: 'Trips' })
    .click();
}

describe('folder preview', () => {
  test('moving between folders shows each one whole, never a loading state', async ({
    app,
    page,
  }) => {
    await openNestedFolder(app, page);
    await page.keyboard.press('Shift+Space');
    const sheet = page.getByRole('dialog', { name: 'Trips' });
    await sheet.getByRole('option', { name: 'a.jpg' }).locator('img').waitFor();
    // Counts every commit that showed the folder loading, or a photo's tile without its image.
    await page.evaluate(() => {
      const target = document.querySelector('dialog') as HTMLElement & { gaps?: number };
      target.gaps = 0;
      new MutationObserver(() => {
        const loading = target.textContent?.includes('Reading folder…');
        const empty = [...target.querySelectorAll('[role="option"]')].some(
          (option) =>
            option.getAttribute('aria-label')?.endsWith('.jpg') &&
            !option.querySelector<HTMLImageElement>('img')?.complete,
        );
        if (loading || empty) {
          target.gaps = (target.gaps ?? 0) + 1;
        }
      }).observe(target, { attributes: true, childList: true, subtree: true });
    });
    await sheet.getByRole('option', { name: 'Beach' }).click();
    await page.keyboard.press('Enter');
    await page
      .getByRole('dialog', { name: 'Beach' })
      .getByRole('option', { name: 'c.jpg' })
      .waitFor();
    await page.getByRole('button', { name: 'Up in folder preview' }).click();
    await sheet.getByRole('option', { name: 'a.jpg' }).waitFor();
    expect(
      await page.evaluate(
        () => (document.querySelector('dialog') as HTMLElement & { gaps?: number }).gaps,
      ),
    ).toBe(0);
  });
});
