import { renderApp } from '#components/__tests__/render';
import { openPhoto, viewer, zoomOf } from '#components/viewer/__tests__/open-photo';
import { requireLibrary } from '#data/session';
import { describe, expect, onTestFinished, test } from 'vitest';
import { userEvent } from 'vitest/browser';

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

  test('shows the last photo stepped to as soon as it has decoded', async () => {
    const { screen } = await openPhoto('landscape.jpg');
    // When the photo's original has been read and decoded, ready to show.
    let read = 0;
    const stopWatching = requireLibrary()
      .queries.getQueryCache()
      .subscribe((event) => {
        const [kind, id] = event.query.queryKey as unknown[];
        if (kind === 'original' && String(id).endsWith('small.jpg') && event.query.state.data) {
          read ||= performance.now();
        }
      });
    onTestFinished(stopWatching);
    await userEvent.keyboard('{ArrowRight}');
    await userEvent.keyboard('{ArrowRight}');
    const photo = viewer(screen).getByRole('img', { name: 'small.jpg' });
    await expect.poll(() => photo.query()?.checkVisibility() ?? false, { interval: 1 }).toBe(true);
    // React holds back what a Suspense boundary reveals until 300 ms after its fallback showed.
    expect(read).toBeGreaterThan(0);
    expect(performance.now() - read).toBeLessThan(150);
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
