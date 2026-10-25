import { openFolder, test } from '#support/fixtures';
import type { ElectronApplication, Page } from 'playwright-core';
import { describe, expect, inject } from 'vitest';

async function openPhoto(page: Page) {
  await openFolder(page);
  await page.getByRole('option', { name: 'landscape.jpg' }).click();
  await page.keyboard.press('Shift+Space');
  await page
    .getByRole('region', { name: 'Image preview' })
    .getByRole('img', { name: 'landscape.jpg' })
    .waitFor({ state: 'visible' });
}

/** The accessible name of what fills the screen, if anything does. */
function fullScreenElement(page: Page) {
  return page.evaluate(() => document.fullscreenElement?.getAttribute('aria-label') ?? null);
}

/** Long enough for the window's own transition in and out of full screen. */
const TRANSITION = { timeout: 5000 };

/** Clicks the View menu item, as the mouse would, with no keypress to count as a gesture. */
function clickMenuItem(app: ElectronApplication) {
  return app.evaluate(({ BrowserWindow, Menu }) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById('full-screen');
    item?.click(undefined, BrowserWindow.getAllWindows()[0]);
    return item?.accelerator;
  });
}

// Going full screen shows even a hidden window, and takes over the screen, so only a headed run
// covers it.
describe.skipIf(!inject('headed'))('full screen', () => {
  test('the View menu shows the photo on its own, and again brings it back', async ({
    app,
    page,
  }) => {
    await openPhoto(page);
    await expect(clickMenuItem(app)).resolves.toBe(
      process.platform === 'darwin' ? 'Cmd+Shift+F' : 'Ctrl+Shift+F',
    );
    await expect.poll(() => fullScreenElement(page), TRANSITION).toBe('Image preview');
    // As leaving full screen on macOS can, drop focus to the page.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await clickMenuItem(app);
    await expect.poll(() => fullScreenElement(page), TRANSITION).toBe(null);
    await page.keyboard.press('ArrowRight');
    await page
      .getByRole('region', { name: 'Image preview' })
      .getByRole('img', { name: 'portrait.jpg' })
      .waitFor({ state: 'visible' });
  });

  test('the toolbar button goes full screen, and Escape leaves the preview open', async ({
    page,
  }) => {
    await openPhoto(page);
    await page.getByRole('button', { name: 'Full screen' }).click();
    await expect.poll(() => fullScreenElement(page), TRANSITION).toBe('Image preview');
    await page.keyboard.press('Escape');
    await expect.poll(() => fullScreenElement(page), TRANSITION).toBe(null);
    await expect(page.getByRole('dialog').isVisible()).resolves.toBe(true);
    // Focus comes back with it, so the arrow keys still browse.
    await page.keyboard.press('ArrowRight');
    await page
      .getByRole('region', { name: 'Image preview' })
      .getByRole('img', { name: 'portrait.jpg' })
      .waitFor({ state: 'visible' });
  });

  test('double-clicking the photo goes full screen, and again comes back', async ({ page }) => {
    await openPhoto(page);
    const photo = page.getByRole('region', { name: 'Image preview' }).getByRole('img', {
      name: 'landscape.jpg',
    });
    await photo.dblclick();
    await expect.poll(() => fullScreenElement(page), TRANSITION).toBe('Image preview');
    await photo.dblclick();
    await expect.poll(() => fullScreenElement(page), TRANSITION).toBe(null);
  });

  test('in full screen, the controls and pointer hide while the pointer rests', async ({
    page,
  }) => {
    await openPhoto(page);
    const viewer = page.getByRole('region', { name: 'Image preview' });
    const controls = page.getByRole('group', { name: 'Photo controls' });
    // The controls fade as a whole, around the toolbar.
    const opacity = () =>
      controls.locator('..').evaluate((element) => getComputedStyle(element).opacity);
    const idle = () => viewer.evaluate((element) => element.dataset.idle ?? null);
    await page.getByRole('button', { name: 'Full screen' }).click();
    await expect.poll(() => fullScreenElement(page), TRANSITION).toBe('Image preview');
    await page.mouse.move(200, 200);
    await expect.poll(opacity).toBe('1');
    await expect.poll(idle, { timeout: 4000 }).toBe('');
    await expect.poll(opacity).toBe('0');
    await expect
      .poll(() => viewer.evaluate((element) => getComputedStyle(element).cursor))
      .toBe('none');
    await page.mouse.move(240, 220);
    await expect.poll(idle).toBe(null);
    await expect.poll(opacity).toBe('1');
    // Resting on a toolbar keeps it, and the pointer, showing.
    await controls.hover();
    await new Promise((resolve) => {
      setTimeout(resolve, 3000);
    });
    await expect(idle()).resolves.toBe(null);
    await page.keyboard.press('Escape');
    await expect.poll(() => fullScreenElement(page), TRANSITION).toBe(null);
  });
});
