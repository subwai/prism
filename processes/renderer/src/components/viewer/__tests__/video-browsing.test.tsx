import { renderApp } from '#components/__tests__/render';
import { openVideo, pause, shown } from '#components/viewer/__tests__/open-video';
import { describe, expect, onTestFinished, test } from 'vitest';
import { userEvent } from 'vitest/browser';

describe('video viewer', () => {
  test('Right moves on from a watched video, and Left comes back', async () => {
    const { screen, video } = await openVideo();
    await pause(video);
    await userEvent.keyboard('{ArrowRight}');
    await shown(screen, 'film.webm');
    await userEvent.keyboard('{ArrowLeft}');
    await shown(screen, 'clip.webm');
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
});
