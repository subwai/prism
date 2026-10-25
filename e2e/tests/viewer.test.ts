import { openFolder, test } from '#support/fixtures';
import type { Page } from 'playwright-core';
import { describe, expect } from 'vitest';

/** The photo's zoom, read from its rendered box so it does not depend on the zoom library. */
function zoomOf(page: Page) {
  return page
    .getByRole('region', { name: 'Image preview' })
    .locator('img:not([alt=""])')
    .evaluate((image: HTMLImageElement) => {
      // Unscaled and rounded to whole pixels, so compare scales with `toBeCloseTo`.
      const width = image.offsetWidth;
      const box = image.getBoundingClientRect();
      return {
        actual: image.naturalWidth / width,
        left: box.left,
        scale: box.width / width,
        top: box.top
      };
    });
}

type Zoom = Awaited<ReturnType<typeof zoomOf>>;

/** Waits for zoom and pan animations to finish, then returns where the photo rests. */
async function settle(page: Page) {
  let previous: Zoom | undefined;
  await expect
    .poll(
      async () => {
        const zoom = await zoomOf(page);
        const still = JSON.stringify(zoom) === JSON.stringify(previous);
        previous = zoom;
        return still;
      },
      { interval: 100 }
    )
    .toBe(true);
  return previous as Zoom;
}

async function openPhoto(page: Page, name: string) {
  await openFolder(page);
  await page.getByRole('option', { name }).click();
  await page.keyboard.press('Shift+Space');
  const photo = page.getByRole('region', { name: 'Image preview' }).getByRole('img', { name });
  await photo.waitFor({ state: 'visible' });
  return photo;
}

/** Where the pointer sits over the photo, off-centre so zooming around it is visible. */
async function pointOver(page: Page) {
  const box = await page.getByRole('region', { name: 'Image preview' }).boundingBox();
  if (!box) {
    throw new Error('The viewer has no box');
  }
  // oxlint-disable-next-line id-length -- Playwright's mouse takes x and y.
  return { x: box.x + box.width * 0.3, y: box.y + box.height * 0.35 };
}

/** A trackpad pinch arrives as wheel events with Ctrl held. */
async function pinch(page: Page, deltaY: number) {
  await page.keyboard.down('Control');
  for (let step = 0; step < 8; step += 1) {
    await page.mouse.wheel(0, deltaY / 8);
  }
  await page.keyboard.up('Control');
}

const toggle = (page: Page) => page.getByRole('button', { name: /actual size|fit to window/iu });

describe('photo viewer zoom', () => {
  test('opens a large photo fitted to the window', async ({ page }) => {
    await openPhoto(page, 'landscape.jpg');
    const zoom = await zoomOf(page);
    expect(zoom.scale).toBeCloseTo(1);
    expect(zoom.actual).toBeGreaterThan(1);
    await expect.poll(() => toggle(page).getAttribute('aria-label')).toBe('View at actual size');
  });

  test('pinching zooms in around the pointer', async ({ page }) => {
    await openPhoto(page, 'landscape.jpg');
    const point = await pointOver(page);
    await page.mouse.move(point.x, point.y);
    await pinch(page, -320);
    await expect.poll(async () => (await zoomOf(page)).scale).toBeGreaterThan(2);
    await expect.poll(() => toggle(page).getAttribute('aria-label')).toBe('Fit to window');
  });

  test('scrolling and dragging pan a zoomed photo', async ({ page }) => {
    await openPhoto(page, 'landscape.jpg');
    const point = await pointOver(page);
    await page.mouse.move(point.x, point.y);
    await pinch(page, -320);
    const zoomed = await settle(page);
    expect(zoomed.scale).toBeGreaterThan(2);

    await page.mouse.wheel(40, 60);
    await expect.poll(async () => (await zoomOf(page)).top).toBeLessThan(zoomed.top);

    const scrolled = await settle(page);
    await page.mouse.down();
    await page.mouse.move(point.x + 120, point.y + 80, { steps: 10 });
    await page.mouse.up();
    await expect.poll(async () => (await zoomOf(page)).left).toBeGreaterThan(scrolled.left);
  });

  test('a plain scroll leaves a fitted photo in place', async ({ page }) => {
    await openPhoto(page, 'landscape.jpg');
    const fitted = await zoomOf(page);
    const point = await pointOver(page);
    await page.mouse.move(point.x, point.y);
    // Upwards, which would zoom in if a plain scroll zoomed.
    await page.mouse.wheel(0, -200);
    expect(await settle(page)).toEqual(fitted);
  });

  test('double-clicking switches between fit and actual size', async ({ page }) => {
    await openPhoto(page, 'landscape.jpg');
    const { actual } = await zoomOf(page);
    const point = await pointOver(page);
    await page.mouse.dblclick(point.x, point.y);
    await expect.poll(async () => (await zoomOf(page)).scale).toBeCloseTo(actual, 1);
    // The viewer toggles from where it last came to rest, so let the zoom finish first.
    await expect.poll(() => toggle(page).getAttribute('aria-label')).toBe('Fit to window');
    await page.mouse.dblclick(point.x, point.y);
    await expect.poll(async () => (await zoomOf(page)).scale).toBeCloseTo(1);
  });

  test('Shift-F shows actual size, and the next photo opens at actual size too', async ({
    page
  }) => {
    await openPhoto(page, 'landscape.jpg');
    await page.keyboard.press('Shift+F');
    const { actual } = await zoomOf(page);
    await expect.poll(async () => (await zoomOf(page)).scale).toBeCloseTo(actual, 1);

    await page.keyboard.press('ArrowRight');
    await page
      .getByRole('region', { name: 'Image preview' })
      .getByRole('img', { name: 'portrait.jpg' })
      .waitFor({ state: 'visible' });
    const next = await zoomOf(page);
    expect(next.scale).toBeCloseTo(next.actual, 1);

    await expect.poll(() => toggle(page).getAttribute('aria-label')).toBe('Fit to window');
    await page.keyboard.press('Shift+F');
    await expect.poll(async () => (await zoomOf(page)).scale).toBeCloseTo(1);
  });
});

describe('Shift-F away from the photo', () => {
  test('works with focus elsewhere in the preview sheet', async ({ page }) => {
    await openPhoto(page, 'landscape.jpg');
    await page.getByRole('dialog').getByRole('button', { name: /close/iu }).focus();
    await page.keyboard.press('Shift+F');
    const { actual } = await zoomOf(page);
    await expect.poll(async () => (await zoomOf(page)).scale).toBeCloseTo(actual, 1);
  });

  test('works in the filmstrip with focus in the sidebar', async ({ page }) => {
    await openFolder(page);
    await page.getByRole('button', { name: 'Filmstrip view' }).click();
    // The filmstrip opens on a video, which has no actual size to show.
    await page
      .getByRole('listbox', { name: 'Photo filmstrip' })
      .getByRole('option', { name: 'landscape.jpg' })
      .click();
    await page
      .getByRole('region', { name: 'Image preview' })
      .getByRole('img', { name: 'landscape.jpg' })
      .waitFor({ state: 'visible' });
    await page.getByRole('tree', { name: 'Folders' }).focus();
    await page.keyboard.press('Shift+F');
    const { actual } = await zoomOf(page);
    await expect.poll(async () => (await zoomOf(page)).scale).toBeCloseTo(actual, 1);
  });
});

describe('photo viewer browsing', () => {
  test('keeps the previous photo on screen until the next one has decoded', async ({ page }) => {
    await openPhoto(page, 'landscape.jpg');
    // Counts every commit that left the viewer without a visible photo.
    await page
      .getByRole('region', { name: 'Image preview' })
      .evaluate((region: HTMLElement & { gaps?: number }) => {
        region.gaps = 0;
        new MutationObserver(() => {
          const photo = region.querySelector('img:not([alt=""]):not(.invisible)');
          if (!photo) {
            region.gaps = (region.gaps ?? 0) + 1;
          }
        }).observe(region, { attributes: true, childList: true, subtree: true });
      });
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    const region = page.getByRole('region', { name: 'Image preview' });
    await region.getByRole('img', { name: 'small.jpg' }).waitFor({ state: 'visible' });
    expect(await region.evaluate((node: HTMLElement & { gaps?: number }) => node.gaps)).toBe(0);
  });
});
