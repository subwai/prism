import { renderApp } from '#components/__tests__/render';
import { expect } from 'vitest';
import { userEvent } from 'vitest/browser';

export type Screen = Awaited<ReturnType<typeof renderApp>>['screen'];

export function viewer(screen: Screen) {
  return screen.getByRole('region', { name: 'Image preview' });
}

/** The photo's zoom, read from its rendered box so it does not depend on the zoom library. */
export function zoomOf(screen: Screen) {
  const image = viewer(screen).element().querySelector<HTMLImageElement>('img:not([alt=""])');
  if (!image) {
    throw new Error('The viewer shows no photo');
  }
  // Unscaled and rounded to whole pixels, so compare scales with `toBeCloseTo`.
  const width = image.offsetWidth;
  const box = image.getBoundingClientRect();
  return {
    actual: image.naturalWidth / width,
    left: box.left,
    scale: box.width / width,
    top: box.top,
  };
}

type Zoom = ReturnType<typeof zoomOf>;

/** Waits for zoom and pan animations to finish, then returns where the photo rests. */
export async function settle(screen: Screen) {
  let previous: Zoom | undefined;
  await expect
    .poll(
      () => {
        const zoom = zoomOf(screen);
        const still = JSON.stringify(zoom) === JSON.stringify(previous);
        previous = zoom;
        return still;
      },
      { interval: 100 },
    )
    .toBe(true);
  return previous as Zoom;
}

export async function openPhoto(name: string) {
  const app = await renderApp();
  await app.screen.getByRole('option', { name }).click();
  await userEvent.keyboard('[Space]');
  await expect.element(viewer(app.screen).getByRole('img', { name })).toBeVisible();
  return app;
}
