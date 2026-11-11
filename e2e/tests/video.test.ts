import { openFolder, test } from '#support/fixtures';
import { VIDEO, WEBM_VIDEO } from '#support/global-setup';
import type { Locator, Page } from 'playwright-core';
import { describe, expect } from 'vitest';

async function openVideo(page: Page) {
  await openFolder(page);
  await page.getByRole('option', { name: VIDEO }).click();
  await page.keyboard.press('Space');
  // By name, since the next video loads hidden alongside the last until it has a frame.
  const video = page
    .getByRole('region', { name: 'Image preview' })
    .locator(`video[aria-label="${VIDEO}"]`);
  await video.waitFor({ state: 'visible' });
  return video;
}

function playback(video: Locator) {
  return video.evaluate((element: HTMLVideoElement) => ({
    paused: element.paused,
    time: element.currentTime,
  }));
}

/** Pauses with the keyboard, so the position holds still between seeks. */
async function pause(page: Page, video: Locator) {
  await expect.poll(async () => (await playback(video)).time).toBeGreaterThan(0);
  await page.keyboard.press('Shift+Space');
  await expect.poll(async () => (await playback(video)).paused).toBe(true);
}

describe('video viewer', () => {
  test('Shift-Space pauses and resumes', async ({ page }) => {
    const video = await openVideo(page);
    await pause(page, video);
    await page.keyboard.press('Shift+Space');
    await expect.poll(async () => (await playback(video)).paused).toBe(false);
    // The preview stays open: Space closes it, Shift-Space does not.
    await expect(video.isVisible()).resolves.toBe(true);
  });

  test('a slow click on Pause lands, though pausing widens the controls', async ({ page }) => {
    const video = await openVideo(page);
    await expect.poll(async () => (await playback(video)).time).toBeGreaterThan(0);
    // Held as long as a slow click, during which nothing may move the button.
    await page.getByRole('button', { name: 'Pause video' }).click({ delay: 300 });
    await expect.poll(async () => (await playback(video)).paused).toBe(true);
  });

  test('Shift-Right and Shift-Left skip five seconds', async ({ page }) => {
    const video = await openVideo(page);
    await pause(page, video);
    // Once watched, the controls point out the keys that seek.
    const hint = page.getByText('seek ·').locator('..');
    await expect.poll(() => hint.getAttribute('inert')).toBeNull();
    const { time } = await playback(video);
    await page.keyboard.press('Shift+ArrowRight');
    await expect.poll(async () => (await playback(video)).time).toBeCloseTo(time + 5, 1);
    await page.keyboard.press('Shift+ArrowLeft');
    await expect.poll(async () => (await playback(video)).time).toBeCloseTo(time, 1);
  });

  test('Right moves on from a watched video, and Left comes back', async ({ page }) => {
    const video = await openVideo(page);
    await pause(page, video);
    await page.keyboard.press('ArrowRight');
    const next = page
      .getByRole('region', { name: 'Image preview' })
      .locator(`video[aria-label="${WEBM_VIDEO}"]`);
    await next.waitFor({ state: 'visible' });
    await page.keyboard.press('ArrowLeft');
    await video.waitFor({ state: 'visible' });
  });

  test('a video stands in with the frame it starts on while it loads', async ({ page }) => {
    const video = await openVideo(page);
    const poster = await video.getAttribute('poster');
    expect(poster).toMatch(/^blob:/u);
    const size = await page.evaluate(async (url) => {
      const image = new Image();
      image.src = url ?? '';
      await image.decode();
      return [image.naturalWidth, image.naturalHeight];
    }, poster);
    await expect(
      video.evaluate((element: HTMLVideoElement) => [element.videoWidth, element.videoHeight]),
    ).resolves.toEqual(size);
  });

  test('in the filmstrip, Shift-Right seeks the video with focus on the strip', async ({
    page,
  }) => {
    await openFolder(page);
    await page.getByRole('button', { name: 'Filmstrip view' }).click();
    const strip = page.getByRole('listbox', { name: 'Photo filmstrip' });
    await strip.getByRole('option', { name: VIDEO }).click();
    const video = page
      .getByRole('region', { name: 'Image preview' })
      .locator(`video[aria-label="${VIDEO}"]`);
    await video.waitFor({ state: 'visible' });
    await pause(page, video);
    const hint = page.getByText('seek ·').locator('..');
    await expect.poll(() => hint.getAttribute('inert')).toBeNull();
    const { time } = await playback(video);
    await page.keyboard.press('Shift+ArrowRight');
    await expect.poll(async () => (await playback(video)).time).toBeCloseTo(time + 5, 1);
    // Right still moves along the strip.
    await page.keyboard.press('ArrowRight');
    await expect
      .poll(() => strip.getByRole('option', { name: VIDEO }).getAttribute('aria-selected'))
      .toBe('false');
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

  test('stay muted after a reload', async ({ page }) => {
    const video = await openVideo(page);
    await page.keyboard.press('Shift+M');
    await page.getByRole('button', { name: 'Unmute' }).waitFor();
    // The reloaded window opens the same folder again, and the same video.
    await page.reload();
    await expect
      .poll(() => video.evaluate((element: HTMLVideoElement) => element.muted))
      .toBe(true);
  });

  test('videos in every format get a still for a thumbnail', async ({ page }) => {
    await openFolder(page);
    for (const name of [VIDEO, WEBM_VIDEO]) {
      const thumbnail = page.getByRole('option', { name }).locator('img');
      await expect
        .poll(() => thumbnail.evaluate((image: HTMLImageElement) => image.naturalWidth), {
          timeout: 15_000,
        })
        .toBeGreaterThan(0);
    }
  });

  test('no video plays on unseen after browsing quickly past it', async ({ page }) => {
    await openFolder(page);
    // Every video the page makes, whether or not it ever reaches the document.
    await page.evaluate(() => {
      const created: HTMLVideoElement[] = [];
      (globalThis as typeof globalThis & { videos?: HTMLVideoElement[] }).videos = created;
      const { createElement } = Document.prototype;
      Document.prototype.createElement = function recordVideos(
        this: Document,
        tagName: string,
        options?: ElementCreationOptions,
      ) {
        const element: unknown = Reflect.apply(createElement, this, [tagName, options]);
        if (element instanceof HTMLVideoElement) {
          created.push(element);
        }
        return element;
      } as typeof createElement;
    });
    await page.getByRole('option', { name: 'landscape.jpg' }).click();
    await page.keyboard.press('Space');
    const preview = page.getByRole('region', { name: 'Image preview' });
    await preview.getByRole('img', { name: 'landscape.jpg' }).waitFor();
    // Back and forth over both videos, faster than they can come up, so the viewer starts
    // showing some and gives up on them for the next.
    for (let round = 0; round < 6; round += 1) {
      for (const key of ['ArrowLeft', 'ArrowLeft', 'ArrowRight', 'ArrowRight']) {
        await page.keyboard.press(key);
        await page.waitForTimeout(15 * (round + 1));
      }
    }
    await preview.getByRole('img', { name: 'landscape.jpg' }).waitFor();
    await page.keyboard.press('Space');
    await preview.waitFor({ state: 'detached' });
    // Long enough for a video given up on to have loaded and started.
    await page.waitForTimeout(1000);
    await expect(
      page.evaluate(
        () =>
          (globalThis as typeof globalThis & { videos?: HTMLVideoElement[] }).videos?.filter(
            (video) => !video.paused,
          ).length,
      ),
    ).resolves.toBe(0);
  });
});
