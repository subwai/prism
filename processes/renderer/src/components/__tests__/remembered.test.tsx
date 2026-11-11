import { renderApp } from '#components/__tests__/render';
import { describe, expect, test } from 'vitest';
import { userEvent } from 'vitest/browser';

/** What the window saved under `key` in local storage, as a reload or launch reads it back. */
function saved(key: string): unknown {
  return JSON.parse(localStorage.getItem(key) ?? 'null');
}

// The window keeps these in local storage, which a reload or launch reads back before its first
// frame. A file's page reads it once, so the first test opens as a reload does, and the second
// checks what the window saves for one.
describe('across reloads and launches', () => {
  test('the sizes, the panes, muting and the volume come back as they were saved', async () => {
    const { screen } = await renderApp({
      saved: {
        'layout-preferences': { coverSize: 48, sidebarWidth: 300, thumbnailSize: 220 },
        'viewer-preferences': { muted: true, volume: 0.5 },
      },
    });
    await expect.element(screen.getByRole('slider', { name: 'Thumbnail size' })).toHaveValue('220');
    await expect
      .element(screen.getByRole('slider', { name: 'Folder cover size' }))
      .toHaveValue('48');
    await expect
      .element(screen.getByRole('separator', { name: 'Resize Library' }))
      .toHaveAttribute('aria-valuenow', '300');
    await screen.getByRole('option', { name: 'clip.webm' }).click();
    await userEvent.keyboard('[Space]');
    const video = screen
      .getByRole('region', { name: 'Image preview' })
      .getByLabelText('clip.webm', { exact: true });
    await expect.element(video).toBeVisible();
    expect((video.element() as HTMLVideoElement).muted).toBe(true);
    expect((video.element() as HTMLVideoElement).volume).toBe(0.5);
  });

  test('changing them saves them', async () => {
    const { screen } = await renderApp();
    await screen.getByRole('slider', { name: 'Thumbnail size' }).fill('200');
    await screen.getByRole('slider', { name: 'Folder cover size' }).fill('40');
    const sidebar = screen.getByRole('separator', { name: 'Resize Library' });
    await expect.element(sidebar).toBeVisible();
    const width = Number(sidebar.element().getAttribute('aria-valuenow')) + 16;
    (sidebar.element() as HTMLElement).focus();
    await userEvent.keyboard('{ArrowRight}');
    await expect.element(sidebar).toHaveAttribute('aria-valuenow', String(width));
    await screen.getByRole('option', { name: 'clip.webm' }).click();
    await userEvent.keyboard('[Space]');
    await expect.element(screen.getByRole('button', { name: 'Mute' })).toBeVisible();
    await userEvent.keyboard('{Shift>}M{/Shift}');
    await expect.element(screen.getByRole('button', { name: 'Unmute' })).toBeVisible();
    expect(saved('layout-preferences')).toMatchObject({
      coverSize: 40,
      sidebarWidth: width,
      thumbnailSize: 200,
    });
    expect(saved('viewer-preferences')).toMatchObject({ muted: true });
  });
});
