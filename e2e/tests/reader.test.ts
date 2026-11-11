import { openFolder, test } from '#support/fixtures';
import type { Page } from 'playwright-core';
import { describe, expect, inject } from 'vitest';

/** How far the reader has scrolled, and where page `index` starts in it. */
function readerScroll(page: Page, index: number) {
  return page.getByRole('region', { name: 'Pages' }).evaluate(
    (reader, at) => ({
      start:
        (reader.querySelector(`[data-index="${at}"]`)?.getBoundingClientRect().top ?? Number.NaN) -
        reader.getBoundingClientRect().top +
        reader.scrollTop,
      top: reader.scrollTop,
    }),
    index,
  );
}

async function openReader(page: Page) {
  await openFolder(page);
  await page.getByRole('button', { name: 'Reader view' }).click();
  const reader = page.getByRole('region', { name: 'Pages' });
  await reader.getByRole('img', { name: 'small.jpg' }).waitFor();
  return reader;
}

/** Where page `index` sits below the top of the reader, to the nearest pixel. */
async function belowTop(page: Page, index: number) {
  const { start, top } = await readerScroll(page, index);
  return Math.round(start - top);
}

describe('the reader', () => {
  test('shows the photos, and Left and Right turn its pages', async ({ page }) => {
    const reader = await openReader(page);
    // Photos only, with nothing to select: no videos, folders or options.
    await expect(
      reader
        .getByRole('img')
        .evaluateAll((images) => images.map((image) => image.getAttribute('alt'))),
    ).resolves.toEqual(['landscape.jpg', 'portrait.jpg', 'small.jpg']);
    await expect(reader.locator('[role=option], [aria-selected]').count()).resolves.toBe(0);
    // It takes focus from the view switch, which went with the grid, so the keys work at once.
    await expect.poll(() => reader.evaluate((node) => node === document.activeElement)).toBe(true);

    await page.keyboard.press('ArrowRight');
    await expect.poll(() => belowTop(page, 1)).toBe(0);
    await page.getByText('portrait.jpg', { exact: true }).waitFor();
    await page.keyboard.press('ArrowLeft');
    await expect.poll(async () => (await readerScroll(page, 0)).top).toBe(0);

    // Down scrolls a little, as it does in a browser, rather than turning the page.
    await page.keyboard.press('ArrowDown');
    await expect.poll(async () => (await readerScroll(page, 1)).top).toBeGreaterThan(0);
    const { start, top } = await readerScroll(page, 1);
    expect(top).toBeLessThan(start);
  });

  test('a slideshow turns a page at a time', async ({ page }) => {
    await openReader(page);
    await page.getByRole('button', { name: 'Start slideshow' }).click();
    await expect.poll(() => belowTop(page, 1), { timeout: 6000 }).toBe(0);
    await page.getByRole('button', { name: 'Pause slideshow' }).click();
    await page.getByRole('button', { name: 'Start slideshow' }).waitFor();
  });
});

/** The accessible name of what fills the screen, if anything does. */
function fullScreenElement(page: Page) {
  return page.evaluate(
    () => document.querySelector('[data-full-screen]')?.getAttribute('aria-label') ?? null,
  );
}

// Going full screen takes over the screen, so only a headed run covers it.
describe.skipIf(!inject('headed'))('the reader in full screen', () => {
  test('double-clicking a page goes full screen, where the arrow keys still work', async ({
    page,
  }) => {
    const reader = await openReader(page);
    await reader.getByRole('img', { name: 'landscape.jpg' }).dblclick();
    await expect.poll(() => fullScreenElement(page), { timeout: 5000 }).toBe('Reader');
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => belowTop(page, 1)).toBe(0);
    await page.keyboard.press('Escape');
    await expect.poll(() => fullScreenElement(page), { timeout: 5000 }).toBe(null);
  });
});
