import { renderApp } from '#components/__tests__/render';
import { expect } from 'vitest';
import { userEvent } from 'vitest/browser';

type Screen = Awaited<ReturnType<typeof renderApp>>['screen'];

/** Renders the app and opens the first video in a preview, once it shows. */
export async function openVideo() {
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
export async function shown(screen: Screen, name: string) {
  const video = screen
    .getByRole('region', { name: 'Image preview' })
    .getByLabelText(name, { exact: true });
  await expect.element(video).toBeVisible();
  return video.element() as HTMLVideoElement;
}

/** Pauses with the keyboard, so the position holds still between seeks. */
export async function pause(video: HTMLVideoElement) {
  await expect.poll(() => video.currentTime).toBeGreaterThan(0);
  await userEvent.keyboard('{Shift>}[Space]{/Shift}');
  await expect.poll(() => video.paused).toBe(true);
}

/**
 * Puts a paused video back at its start, so a five-second seek stays inside the six-second
 * clip however long it played before pausing, which on a busy runner can be over a second.
 */
export async function rewind(video: HTMLVideoElement) {
  video.currentTime = 0;
  await expect.poll(() => video.currentTime).toBe(0);
}
