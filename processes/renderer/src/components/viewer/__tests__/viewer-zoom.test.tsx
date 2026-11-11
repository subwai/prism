import { openPhoto, type Screen, viewer, zoomOf } from '#components/viewer/__tests__/open-photo';
import { describe, expect, test } from 'vitest';
import { userEvent } from 'vitest/browser';

const toggle = (screen: Screen) =>
  screen.getByRole('button', { name: /actual size|fit to window/iu });

describe('photo viewer zoom', () => {
  test('opens a large photo fitted to the window', async () => {
    const { screen } = await openPhoto('landscape.jpg');
    const zoom = zoomOf(screen);
    expect(zoom.scale).toBeCloseTo(1);
    expect(zoom.actual).toBeGreaterThan(1);
    await expect.element(toggle(screen)).toHaveAccessibleName('View at actual size');
  });

  test('Option-double-clicking switches between fit and actual size', async () => {
    const { screen } = await openPhoto('landscape.jpg');
    const { actual } = zoomOf(screen);
    const photo = viewer(screen).getByRole('img', { name: 'landscape.jpg' });
    await userEvent.keyboard('{Alt>}');
    // The zoom library turns off pointer events on the photo, so the double-click lands on its
    // frame, as the mouse's does.
    await userEvent.dblClick(photo, { force: true });
    await expect.poll(() => zoomOf(screen).scale).toBeCloseTo(actual, 1);
    // The viewer toggles from where it last came to rest, so let the zoom finish first.
    await expect.element(toggle(screen)).toHaveAccessibleName('Fit to window');
    await userEvent.dblClick(photo, { force: true });
    await expect.poll(() => zoomOf(screen).scale).toBeCloseTo(1);
    await userEvent.keyboard('{/Alt}');
  });

  test('Shift-F shows actual size, and the next photo opens at actual size too', async () => {
    const { screen } = await openPhoto('landscape.jpg');
    await userEvent.keyboard('{Shift>}F{/Shift}');
    const { actual } = zoomOf(screen);
    await expect.poll(() => zoomOf(screen).scale).toBeCloseTo(actual, 1);

    await userEvent.keyboard('{ArrowRight}');
    await expect.element(viewer(screen).getByRole('img', { name: 'portrait.jpg' })).toBeVisible();
    const next = zoomOf(screen);
    expect(next.scale).toBeCloseTo(next.actual, 1);

    await expect.element(toggle(screen)).toHaveAccessibleName('Fit to window');
    await userEvent.keyboard('{Shift>}F{/Shift}');
    await expect.poll(() => zoomOf(screen).scale).toBeCloseTo(1);
  });
});
