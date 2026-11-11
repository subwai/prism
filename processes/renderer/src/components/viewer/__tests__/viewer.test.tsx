import { renderApp } from '#components/__tests__/render';
import { describe, expect, test } from 'vitest';
import { commands, userEvent } from 'vitest/browser';

type Screen = Awaited<ReturnType<typeof renderApp>>['screen'];

function viewer(screen: Screen) {
  return screen.getByRole('region', { name: 'Image preview' });
}

/** The photo's zoom, read from its rendered box so it does not depend on the zoom library. */
function zoomOf(screen: Screen) {
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
async function settle(screen: Screen) {
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

async function openPhoto(name: string) {
  const app = await renderApp();
  await app.screen.getByRole('option', { name }).click();
  await userEvent.keyboard('[Space]');
  await expect.element(viewer(app.screen).getByRole('img', { name })).toBeVisible();
  return app;
}

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

describe('Shift-F away from the photo', () => {
  test('works with focus elsewhere in the preview sheet', async () => {
    const { screen } = await openPhoto('landscape.jpg');
    screen.getByRole('dialog').getByRole('button', { name: /close/iu }).element().focus();
    await userEvent.keyboard('{Shift>}F{/Shift}');
    const { actual } = zoomOf(screen);
    await expect.poll(() => zoomOf(screen).scale).toBeCloseTo(actual, 1);
  });

  test('works in the filmstrip with focus in the sidebar', async () => {
    const { screen } = await renderApp();
    await screen.getByRole('button', { name: 'Filmstrip view' }).click();
    // The filmstrip opens on a video, which has no actual size to show.
    await screen
      .getByRole('listbox', { name: 'Photo filmstrip' })
      .getByRole('option', { name: 'landscape.jpg' })
      .click();
    await expect.element(viewer(screen).getByRole('img', { name: 'landscape.jpg' })).toBeVisible();
    screen.getByRole('tree', { name: 'Folders' }).element().focus();
    await userEvent.keyboard('{Shift>}F{/Shift}');
    const { actual } = zoomOf(screen);
    await expect.poll(() => zoomOf(screen).scale).toBeCloseTo(actual, 1);
  });

  test('the filmstrip opens no preview, from the strip or the sidebar', async () => {
    const { screen } = await renderApp();
    await screen.getByRole('button', { name: 'Filmstrip view' }).click();
    const option = screen
      .getByRole('listbox', { name: 'Photo filmstrip' })
      .getByRole('option', { name: 'landscape.jpg' });
    await option.click();
    await userEvent.keyboard('[Space]');
    await userEvent.keyboard('{Enter}');
    await option.dblClick();
    screen.getByRole('tree', { name: 'Folders' }).element().focus();
    await userEvent.keyboard('[Space]');
    // A preview would open as a sheet over the filmstrip.
    expect(screen.getByRole('dialog').elements()).toHaveLength(0);
  });
});

describe('photo viewer browsing', () => {
  test('keeps the previous photo on screen until the next one has decoded', async () => {
    const { screen } = await openPhoto('landscape.jpg');
    // Counts every commit that left the viewer without a visible photo.
    const region = viewer(screen).element();
    let gaps = 0;
    const observer = new MutationObserver(() => {
      if (!region.querySelector('img:not([alt=""]):not(.invisible)')) {
        gaps += 1;
      }
    });
    observer.observe(region, { attributes: true, childList: true, subtree: true });
    await userEvent.keyboard('{ArrowRight}');
    await userEvent.keyboard('{ArrowRight}');
    await expect.element(viewer(screen).getByRole('img', { name: 'small.jpg' })).toBeVisible();
    observer.disconnect();
    expect(gaps).toBe(0);
  });
});

describe('preview in history', () => {
  test('Back closes a preview, and Forward opens it again', async () => {
    const { navigate, screen } = await openPhoto('landscape.jpg');
    const sheet = screen.getByRole('dialog', { name: 'landscape.jpg' });
    await navigate(-1);
    await expect.element(sheet).not.toBeInTheDocument();
    await navigate(1);
    await expect.element(sheet).toBeVisible();
  });
});
