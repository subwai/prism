import { skippableTimers } from '#components/__tests__/render';
import { openVideo } from '#components/viewer/__tests__/open-video';
import { IDLE_MS } from '#components/viewer/use-idle-pointer';
import { describe, expect, test, vi } from 'vitest';
import { userEvent } from 'vitest/browser';

describe('video viewer', () => {
  test('a slow click on Pause lands, though pausing widens the controls', async () => {
    const { screen, video } = await openVideo();
    await expect.poll(() => video.currentTime).toBeGreaterThan(0);
    // Held as long as a slow click, during which nothing may move the button.
    await screen.getByRole('button', { name: 'Pause video' }).click({ delay: 300 });
    await expect.poll(() => video.paused).toBe(true);
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

  test('the volume slider slides out beside the mute button, which stays put', async () => {
    const { screen } = await openVideo();
    const mute = screen.getByRole('button', { name: 'Mute' });
    const slider = screen.getByRole('slider', { name: 'Volume' });
    // What clips the slider while it is closed.
    const drawer = () => slider.element().closest('[data-volume] > span') as HTMLElement;
    await expect.element(mute).toBeVisible();
    expect(drawer().getBoundingClientRect().width).toBe(0);
    const { left } = mute.element().getBoundingClientRect();
    await mute.hover();
    await expect.poll(() => drawer().getBoundingClientRect().width).toBe(96);
    await expect.poll(() => mute.element().getBoundingClientRect().left).toBeCloseTo(left, 0);
    await screen.getByRole('button', { name: 'Pause video' }).hover();
    await expect.poll(() => drawer().getBoundingClientRect().width).toBe(0);
  });

  test('the volume slider sets the volume, and unmutes', async () => {
    const { screen, video } = await openVideo();
    await userEvent.keyboard('{Shift>}M{/Shift}');
    await expect.poll(() => video.muted).toBe(true);
    const slider = screen.getByRole('slider', { name: 'Volume' });
    await expect.element(slider).toHaveValue('0');
    await screen.getByRole('button', { name: 'Unmute' }).hover();
    await slider.fill('0.4');
    await expect.poll(() => video.volume).toBeCloseTo(0.4);
    expect(video.muted).toBe(false);
    await expect.element(screen.getByRole('button', { name: 'Mute' })).toBeVisible();
  });

  test('unmuting a video turned all the way down brings it back at full volume', async () => {
    const { screen, video } = await openVideo();
    await screen.getByRole('button', { name: 'Mute' }).hover();
    await screen.getByRole('slider', { name: 'Volume' }).fill('0');
    await expect.poll(() => video.volume).toBe(0);
    await screen.getByRole('button', { name: 'Unmute' }).click();
    await expect.poll(() => video.volume).toBe(1);
    await expect.element(screen.getByRole('button', { name: 'Mute' })).toBeVisible();
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
    skippableTimers();
    await userEvent.hover(video);
    await expect.poll(opacities).toEqual(['1', '1']);
    await vi.advanceTimersByTimeAsync(IDLE_MS);
    await expect.poll(opacities).toEqual(['0', '0']);
    expect(getComputedStyle(viewer.element()).cursor).toBe('none');
    // Pointing at a toolbar brings it all back.
    await userEvent.hover(playback);
    await expect.poll(opacities).toEqual(['1', '1']);
  });
});
