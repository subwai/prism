import { test } from '#support/fixtures';
import { expectScreenshot } from '#support/screenshots';
import type { Page } from 'playwright-core';
import { describe } from 'vitest';

/** The catalog's sections, by their headings, each screenshotted on its own. */
const SECTIONS = [
  'Colours',
  'Type',
  'Radii and shadows',
  'Buttons',
  'Fields',
  'Toolbar',
  'Sidebar',
  'Feedback',
  'Media',
];

/** Opens the catalog with the theme's own accent, so screenshots match on any system. */
async function openCatalog(page: Page) {
  await page.setViewportSize({ height: 900, width: 1100 });
  // Loaded as View > Design System loads it. The router only hears `popstate` once it has
  // hydrated, so pushing the URL any earlier left the app on the welcome screen.
  await page.goto(new URL('/design-system', page.url()).href);
  await page.getByRole('heading', { name: 'Design system' }).waitFor();
  await page.evaluate(() => document.documentElement.style.removeProperty('--system-accent'));
  await page.evaluate(() => document.fonts.ready);
}

function slug(title: string) {
  return title.toLowerCase().replaceAll(/\W+/gu, '-');
}

describe('the design system', () => {
  test('looks as it did', async ({ page, annotate }) => {
    await openCatalog(page);
    for (const title of SECTIONS) {
      // oxlint-disable-next-line no-await-in-loop -- One at a time, each scrolled into view.
      await expectScreenshot(
        page.locator(`[data-catalog="${title}"]`),
        `design-system-${slug(title)}`,
        annotate,
      );
    }
  });

  test('a small dialog', async ({ page, annotate }) => {
    await openCatalog(page);
    await page.getByRole('button', { name: 'Open dialog' }).click();
    const dialog = page.getByRole('dialog', { name: 'Rename “landscape.jpg”' });
    await dialog.waitFor();
    await expectScreenshot(dialog, 'design-system-dialog', annotate);
  });
});
