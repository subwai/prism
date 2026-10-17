import { openFolder, test } from './fixtures.ts';
import { VIDEO, WEBM_VIDEO } from './global-setup.ts';
import type { Locator, Page } from 'playwright-core';
import { describe, expect } from 'vitest';

async function openVideo(page: Page) {
  await openFolder(page);
  await page.getByRole('option', { name: VIDEO }).click();
  await page.keyboard.press('Space');
  const video = page.getByRole('region', { name: 'Image preview' }).locator('video');
  await video.waitFor({ state: 'visible' });
  return video;
}

function playback(video: Locator) {
  return video.evaluate((element: HTMLVideoElement) => ({
    paused: element.paused,
    time: element.currentTime
  }));
}

/** Pauses with the keyboard, so the position holds still between seeks. */
async function pause(page: Page, video: Locator) {
  await expect.poll(async () => (await playback(video)).time).toBeGreaterThan(0);
  await page.keyboard.press('Shift+Space');
  await expect.poll(async () => (await playback(video)).paused).toBe(true);
}

describe('video viewer', () => {
  test('plays a video when it opens', async ({ page }) => {
    const video = await openVideo(page);
    await expect.poll(async () => (await playback(video)).time).toBeGreaterThan(0.5);
    expect((await playback(video)).paused).toBe(false);
  });

  test('Shift-Space pauses and resumes', async ({ page }) => {
    const video = await openVideo(page);
    await pause(page, video);
    await page.keyboard.press('Shift+Space');
    await expect.poll(async () => (await playback(video)).paused).toBe(false);
    // The preview stays open: plain Space closes it, Shift-Space does not.
    await expect(video.isVisible()).resolves.toBe(true);
  });

  test('Shift-Right and Shift-Left skip five seconds', async ({ page }) => {
    const video = await openVideo(page);
    await pause(page, video);
    const { time } = await playback(video);
    await page.keyboard.press('Shift+ArrowRight');
    await expect.poll(async () => (await playback(video)).time).toBeCloseTo(time + 5, 1);
    await page.keyboard.press('Shift+ArrowLeft');
    await expect.poll(async () => (await playback(video)).time).toBeCloseTo(time, 1);
  });

  test('Shift-M mutes and unmutes', async ({ page }) => {
    const video = await openVideo(page);
    const muted = () => video.evaluate((element: HTMLVideoElement) => element.muted);
    await expect(muted()).resolves.toBe(false);
    await page.keyboard.press('Shift+M');
    await expect.poll(muted).toBe(true);
    await expect(page.getByRole('button', { name: 'Unmute' }).isVisible()).resolves.toBe(true);
    await page.keyboard.press('Shift+M');
    await expect.poll(muted).toBe(false);
  });

  test('the arrow keys still browse to the next item', async ({ page }) => {
    await openVideo(page);
    await page.keyboard.press('ArrowRight');
    await page
      .getByRole('region', { name: 'Image preview' })
      .locator(`video[aria-label="${WEBM_VIDEO}"]`)
      .waitFor({ state: 'visible' });
  });

  test('videos in every format get a still for a thumbnail', async ({ page }) => {
    await openFolder(page);
    for (const name of [VIDEO, WEBM_VIDEO]) {
      const thumbnail = page.getByRole('option', { name }).locator('img');
      await expect
        .poll(() => thumbnail.evaluate((image: HTMLImageElement) => image.naturalWidth), {
          timeout: 15_000
        })
        .toBeGreaterThan(0);
    }
  });
});
