import { renderApp } from '#components/__tests__/render';
import { describe, expect, onTestFinished, test } from 'vitest';
import { userEvent } from 'vitest/browser';

type Screen = Awaited<ReturnType<typeof renderApp>>['screen'];

async function openVideo() {
  const app = await renderApp();
  await app.screen.getByRole('option', { name: 'clip.webm' }).click();
  await userEvent.keyboard('[Space]');
  const video = await shown(app.screen, 'clip.webm');
  return { ...app, video };
}

/**
 * Waits for the video `name` to show in the viewer, and returns it: by name, since the next
 * video loads hidden alongside the last until it has a frame.
 */
async function shown(screen: Screen, name: string) {
  const video = screen
    .getByRole('region', { name: 'Image preview' })
    .getByLabelText(name, { exact: true });
  await expect.element(video).toBeVisible();
  return video.element() as HTMLVideoElement;
}

/** Pauses with the keyboard, so the position holds still between seeks. */
async function pause(video: HTMLVideoElement) {
  await expect.poll(() => video.currentTime).toBeGreaterThan(0);
  await userEvent.keyboard('{Shift>}[Space]{/Shift}');
  await expect.poll(() => video.paused).toBe(true);
}

describe('video viewer', () => {
  test('Shift-Space pauses and resumes', async () => {
    const { video } = await openVideo();
    await pause(video);
    await userEvent.keyboard('{Shift>}[Space]{/Shift}');
    await expect.poll(() => video.paused).toBe(false);
    // The preview stays open: Space closes it, Shift-Space does not.
    expect(video.isConnected).toBe(true);
  });

  test('a slow click on Pause lands, though pausing widens the controls', async () => {
    const { screen, video } = await openVideo();
    await expect.poll(() => video.currentTime).toBeGreaterThan(0);
    // Held as long as a slow click, during which nothing may move the button.
    await screen.getByRole('button', { name: 'Pause video' }).click({ delay: 300 });
    await expect.poll(() => video.paused).toBe(true);
  });

  test('Shift-Right and Shift-Left skip five seconds', async () => {
    const { screen, video } = await openVideo();
    await pause(video);
    // Once watched, the controls point out the keys that seek.
    await expect
      .poll(() =>
        screen
          .getByText(/seek ·/u)
          .element()
          .parentElement?.hasAttribute('inert'),
      )
      .toBe(false);
    const time = video.currentTime;
    await userEvent.keyboard('{Shift>}{ArrowRight}{/Shift}');
    await expect.poll(() => video.currentTime).toBeCloseTo(time + 5, 1);
    await userEvent.keyboard('{Shift>}{ArrowLeft}{/Shift}');
    await expect.poll(() => video.currentTime).toBeCloseTo(time, 1);
  });

  test('Right moves on from a watched video, and Left comes back', async () => {
    const { screen, video } = await openVideo();
    await pause(video);
    await userEvent.keyboard('{ArrowRight}');
    await shown(screen, 'film.webm');
    await userEvent.keyboard('{ArrowLeft}');
    await shown(screen, 'clip.webm');
  });

  test('a video stands in with the frame it starts on while it loads', async () => {
    const { video } = await openVideo();
    expect(video.poster).toMatch(/^blob:/u);
    const image = new Image();
    image.src = video.poster;
    await image.decode();
    await expect
      .poll(() => [video.videoWidth, video.videoHeight])
      .toEqual([image.naturalWidth, image.naturalHeight]);
  });

  test('in the filmstrip, Shift-Right seeks the video with focus on the strip', async () => {
    const { screen } = await renderApp();
    await screen.getByRole('button', { name: 'Filmstrip view' }).click();
    const option = screen
      .getByRole('listbox', { name: 'Photo filmstrip' })
      .getByRole('option', { name: 'clip.webm' });
    await option.click();
    const video = await shown(screen, 'clip.webm');
    await pause(video);
    await expect
      .poll(() =>
        screen
          .getByText(/seek ·/u)
          .element()
          .parentElement?.hasAttribute('inert'),
      )
      .toBe(false);
    const time = video.currentTime;
    await userEvent.keyboard('{Shift>}{ArrowRight}{/Shift}');
    await expect.poll(() => video.currentTime).toBeCloseTo(time + 5, 1);
    // Right still moves along the strip.
    await userEvent.keyboard('{ArrowRight}');
    await expect.element(option).toHaveAttribute('aria-selected', 'false');
  });

  test('Shift-M mutes and unmutes', async () => {
    const { screen, video } = await openVideo();
    expect(video.muted).toBe(false);
    await userEvent.keyboard('{Shift>}M{/Shift}');
    await expect.poll(() => video.muted).toBe(true);
    await expect.element(screen.getByRole('button', { name: 'Unmute' })).toBeVisible();
    await userEvent.keyboard('{Shift>}M{/Shift}');
    await expect.poll(() => video.muted).toBe(false);
  });

  test('no video plays on unseen after browsing quickly past it', async () => {
    const { screen } = await renderApp();
    // Every video the page makes, whether or not it ever reaches the document.
    const videos: HTMLVideoElement[] = [];
    const { createElement } = Document.prototype;
    Document.prototype.createElement = function recordVideos(
      this: Document,
      tagName: string,
      options?: ElementCreationOptions,
    ) {
      const element: unknown = Reflect.apply(createElement, this, [tagName, options]);
      if (element instanceof HTMLVideoElement) {
        videos.push(element);
      }
      return element;
    } as typeof createElement;
    onTestFinished(() => {
      Document.prototype.createElement = createElement;
    });
    await screen.getByRole('option', { name: 'landscape.jpg' }).click();
    await userEvent.keyboard('[Space]');
    const preview = screen.getByRole('region', { name: 'Image preview' });
    const photo = preview.getByRole('img', { name: 'landscape.jpg' });
    await expect.element(photo).toBeVisible();
    // Back and forth over both videos, faster than they can come up, so the viewer starts
    // showing some and gives up on them for the next.
    for (let round = 0; round < 6; round += 1) {
      for (const key of ['{ArrowLeft}', '{ArrowLeft}', '{ArrowRight}', '{ArrowRight}']) {
        await userEvent.keyboard(key);
        await new Promise((resolve) => {
          setTimeout(resolve, 15 * (round + 1));
        });
      }
    }
    await expect.element(photo).toBeVisible();
    await userEvent.keyboard('[Space]');
    await expect.element(preview).not.toBeInTheDocument();
    // Long enough for a video given up on to have loaded and started.
    await new Promise((resolve) => {
      setTimeout(resolve, 1000);
    });
    expect(videos.filter((video) => !video.paused)).toHaveLength(0);
  });

  test('in a preview, the controls and the pointer hide while the pointer rests', async () => {
    const { screen, video } = await openVideo();
    const viewer = screen.getByRole('region', { name: 'Image preview' });
    const playback = screen.getByRole('group', { name: 'Video controls' });
    const toolbars = [screen.getByRole('group', { name: 'Photo controls' }), playback];
    // Each toolbar fades as a whole, around it.
    const opacities = () =>
      toolbars.map(
        (toolbar) => getComputedStyle(toolbar.element().parentElement as Element).opacity,
      );
    await userEvent.hover(video);
    await expect.poll(opacities).toEqual(['1', '1']);
    await expect.poll(opacities, { timeout: 4000 }).toEqual(['0', '0']);
    expect(getComputedStyle(viewer.element()).cursor).toBe('none');
    // Pointing at a toolbar brings it all back.
    await userEvent.hover(playback);
    await expect.poll(opacities).toEqual(['1', '1']);
  });
});
