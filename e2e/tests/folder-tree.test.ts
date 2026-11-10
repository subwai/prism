import { test } from '#support/fixtures';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, onTestFinished } from 'vitest';

describe('the folder tree', () => {
  test('opens the folders it had open again after a reload', async ({ app, page }) => {
    const folder = await mkdtemp(path.join(os.tmpdir(), 'e2e-tree-'));
    onTestFinished(() => rm(folder, { force: true, recursive: true }));
    await mkdir(path.join(folder, 'Trips', 'Beach'), { recursive: true });
    await app.evaluate(({ dialog }, chosen) => {
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [chosen] });
    }, folder);
    await page.getByRole('button', { name: 'Choose a folder' }).click();
    const tree = page.getByRole('tree', { name: 'Folders' });
    const trips = tree.getByRole('treeitem', { name: 'Trips' });
    await trips.waitFor();
    await expect(trips.getAttribute('aria-expanded')).resolves.toBe('false');
    await tree.focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowRight');
    await tree.getByRole('treeitem', { name: 'Beach' }).waitFor();
    // The reloaded window opens the same folder again, and its tree as it was.
    await page.reload();
    await page.getByRole('listbox', { name: 'Folder contents' }).waitFor();
    await tree.getByRole('treeitem', { name: 'Beach' }).waitFor();
    await expect(trips.getAttribute('aria-expanded')).resolves.toBe('true');
  });
});
