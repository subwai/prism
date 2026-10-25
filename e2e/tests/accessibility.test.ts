import { openFolder, test } from '#support/fixtures';
import { AxeBuilder } from '@axe-core/playwright';
import type { Page } from 'playwright-core';
import { describe, expect } from 'vitest';

/** What axe finds wrong with the window as it is: each rule broken, and where. */
async function violations(page: Page) {
  // Legacy mode runs axe in the window itself; otherwise it opens a blank page to finish in,
  // which Electron does not allow. Contrast is left out: axe cannot see the vibrancy behind the
  // sidebar, so it judges the text there against white, and the faintest labels, like macOS's
  // tertiary ones, are below 4.5:1 on purpose.
  const results = await new AxeBuilder({ page })
    .setLegacyMode()
    .disableRules(['color-contrast'])
    .analyze();
  return results.violations.map((violation) => ({
    rule: violation.id,
    targets: violation.nodes.map((node) => node.target.join(' '))
  }));
}

function isFocused(page: Page, role: 'listbox', name: string) {
  return page.getByRole(role, { name }).evaluate((element) => element === document.activeElement);
}

describe('accessibility', () => {
  test('the welcome screen', async ({ page }) => {
    await page.getByRole('button', { name: 'Choose a folder' }).waitFor();
    await expect(violations(page)).resolves.toEqual([]);
  });

  test('the grid', async ({ page }) => {
    await openFolder(page);
    await page.getByRole('option', { name: 'landscape.jpg' }).click();
    await expect(violations(page)).resolves.toEqual([]);
  });

  test('the filmstrip', async ({ page }) => {
    await openFolder(page);
    await page.getByRole('button', { name: 'Filmstrip view' }).click();
    await page.getByRole('listbox', { name: 'Photo filmstrip' }).waitFor();
    await expect(violations(page)).resolves.toEqual([]);
  });

  test('a photo preview', async ({ page }) => {
    await openFolder(page);
    await page.getByRole('option', { name: 'landscape.jpg' }).click();
    await page.keyboard.press('Shift+Space');
    await page.getByRole('dialog', { name: 'landscape.jpg' }).getByRole('img').waitFor();
    await expect(violations(page)).resolves.toEqual([]);
  });

  test('the rename dialog, opened from the keyboard', async ({ page }) => {
    await openFolder(page);
    await page.getByRole('option', { name: 'landscape.jpg' }).click();
    await page.keyboard.press('F2');
    await page.getByRole('dialog', { name: 'Rename “landscape.jpg”' }).waitFor();
    await expect(violations(page)).resolves.toEqual([]);
  });

  test('the viewer says which photo it moves to', async ({ page }) => {
    await openFolder(page);
    await page.getByRole('option', { name: 'landscape.jpg' }).click();
    await page.keyboard.press('Shift+Space');
    const viewer = page.getByRole('dialog').getByRole('region', { name: 'Image preview' });
    await viewer.getByRole('img', { name: 'landscape.jpg' }).waitFor();
    await page.keyboard.press('ArrowRight');
    // Videos count too, sorted by name before the photos.
    await expect
      .poll(() => viewer.locator('[aria-live="polite"]').textContent())
      .toBe('portrait.jpg, 4 of 5');
  });

  test('Increase Contrast strengthens the faintest labels', async ({ page }) => {
    await openFolder(page);
    const tertiary = () =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--color-label-tertiary')
      );
    const normal = await tertiary();
    await page.emulateMedia({ contrast: 'more' });
    await expect.poll(tertiary).not.toBe(normal);
  });

  test('high contrast themes outline what is selected', async ({ page }) => {
    await openFolder(page);
    const option = page.getByRole('option', { name: 'landscape.jpg' });
    await option.click();
    await page.emulateMedia({ forcedColors: 'active' });
    await expect
      .poll(() => option.evaluate((element) => getComputedStyle(element).outlineStyle))
      .toBe('solid');
  });

  test('controls tell screen readers their shortcuts', async ({ page }) => {
    await openFolder(page);
    const refresh = page.getByRole('button', { name: 'Refresh folder' });
    await expect(refresh.getAttribute('aria-keyshortcuts')).resolves.toBe(
      process.platform === 'darwin' ? 'Meta+R' : 'Control+R'
    );
  });

  test('focus moves to the new view when the control that had it goes', async ({ page }) => {
    await openFolder(page);
    // The view switch belongs to the view it replaces, so focus would otherwise be lost.
    await page.getByRole('button', { name: 'Filmstrip view' }).click();
    await expect.poll(() => isFocused(page, 'listbox', 'Photo filmstrip')).toBe(true);
    await page.getByRole('button', { name: 'Grid view' }).click();
    await expect.poll(() => isFocused(page, 'listbox', 'Folder contents')).toBe(true);
  });
});
