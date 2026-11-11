import { renderApp } from '#components/__tests__/render';
import { openVideo, pause, rewind, shown } from '#components/viewer/__tests__/open-video';
import { describe, expect, test } from 'vitest';
import { userEvent } from 'vitest/browser';

describe('video viewer', () => {
  test('Shift-Space pauses and resumes', async () => {
    const { video } = await openVideo();
    await pause(video);
    await userEvent.keyboard('{Shift>}[Space]{/Shift}');
    await expect.poll(() => video.paused).toBe(false);
    // The preview stays open: Space closes it, Shift-Space does not.
    expect(video.isConnected).toBe(true);
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
    await rewind(video);
    await userEvent.keyboard('{Shift>}{ArrowRight}{/Shift}');
    await expect.poll(() => video.currentTime).toBeCloseTo(5, 1);
    await userEvent.keyboard('{Shift>}{ArrowLeft}{/Shift}');
    await expect.poll(() => video.currentTime).toBeCloseTo(0, 1);
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
    await rewind(video);
    await userEvent.keyboard('{Shift>}{ArrowRight}{/Shift}');
    await expect.poll(() => video.currentTime).toBeCloseTo(5, 1);
    // Right still moves along the strip.
    await userEvent.keyboard('{ArrowRight}');
    await expect.element(option).toHaveAttribute('aria-selected', 'false');
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
});
