import {
  openPhoto,
  type Screen,
  settle,
  viewer,
  zoomOf,
} from '#components/viewer/__tests__/open-photo';
import { describe, expect, test } from 'vitest';
import { commands, userEvent } from 'vitest/browser';

/** Where the pointer sits over the photo, off-centre so zooming around it is visible. */
function pointOver(screen: Screen) {
  const box = viewer(screen).element().getBoundingClientRect();
  return { left: box.left + box.width * 0.3, top: box.top + box.height * 0.35 };
}

/** A trackpad pinch arrives as wheel events with Ctrl held. */
async function pinch(screen: Screen, deltaY: number) {
  await userEvent.keyboard('{Control>}');
  // oxlint-disable-next-line id-length -- Vitest's wheel takes x and y.
  await userEvent.wheel(viewer(screen), { delta: { y: deltaY / 8 }, times: 8 });
  await userEvent.keyboard('{/Control}');
}

describe('photo viewer zoom', () => {
  test('scrolling and dragging pan a zoomed photo', async () => {
    const { screen } = await openPhoto('landscape.jpg');
    const point = pointOver(screen);
    await commands.mouse([{ move: point }]);
    await pinch(screen, -320);
    const zoomed = await settle(screen);
    expect(zoomed.scale).toBeGreaterThan(2);

    // oxlint-disable-next-line id-length -- Vitest's wheel takes x and y.
    await userEvent.wheel(viewer(screen), { delta: { x: 40, y: 60 } });
    await expect.poll(() => zoomOf(screen).top).toBeLessThan(zoomed.top);

    const scrolled = await settle(screen);
    await commands.mouse([
      { move: point },
      { down: true },
      { move: { left: point.left + 120, top: point.top + 80 }, steps: 10 },
      { up: true },
    ]);
    await expect.poll(() => zoomOf(screen).left).toBeGreaterThan(scrolled.left);
  });

  test('a plain scroll leaves a fitted photo in place', async () => {
    const { screen } = await openPhoto('landscape.jpg');
    const fitted = zoomOf(screen);
    // Upwards, which would zoom in if a plain scroll zoomed.
    // oxlint-disable-next-line id-length -- Vitest's wheel takes x and y.
    await userEvent.wheel(viewer(screen), { delta: { y: -200 } });
    expect(await settle(screen)).toEqual(fitted);
  });
});
