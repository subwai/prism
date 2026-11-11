import { openFolder, test } from '#support/fixtures';
import { VIDEO, WEBM_VIDEO } from '#support/global-setup';
import { describe, expect } from 'vitest';

// The video player's own behaviour is covered by the renderer's component tests; this needs the
// system's thumbnailer, which cannot read VP9, and the window's stand-in for it.
describe('video thumbnails', () => {
  test('videos in every format get a still for a thumbnail', async ({ page }) => {
    await openFolder(page);
    for (const name of [VIDEO, WEBM_VIDEO]) {
      const thumbnail = page.getByRole('option', { name }).locator('img');
      await expect
        .poll(() => thumbnail.evaluate((image: HTMLImageElement) => image.naturalWidth), {
          timeout: 15_000,
        })
        .toBeGreaterThan(0);
    }
  });
});
