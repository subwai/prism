import { renderApp } from '#components/__tests__/render';
import { describe, expect, test } from 'vitest';
import { commands } from 'vitest/browser';

describe('size sliders', () => {
  test('go back to their default size on a double-click', async () => {
    const { screen } = await renderApp();
    for (const { name, size, max } of [
      { max: '240', name: 'Thumbnail size', size: '170' },
      { max: '64', name: 'Folder cover size', size: '32' },
    ]) {
      const slider = screen.getByRole('slider', { name });
      await expect.element(slider).toHaveValue(size);
      await slider.fill(max);
      await expect.element(slider).toHaveValue(max);
      await slider.dblClick();
      await expect.element(slider).toHaveValue(size);
    }
  });

  test('snap to their default size while dragging, until held there', async () => {
    const { screen } = await renderApp();
    const slider = screen.getByRole('slider', { name: 'Thumbnail size' });
    await expect.element(slider).toBeVisible();
    const box = slider.element().getBoundingClientRect();
    // Where the thumb's centre is at a size, from 110 to 240; it is 15px wide.
    const at = (size: number) => ({
      left: box.left + 7.5 + ((size - 110) / 130) * (box.width - 15),
      top: box.top + box.height / 2,
    });
    await commands.mouse([{ move: at(230) }, { down: true }]);
    await expect.element(slider).toHaveValue('230');
    await commands.mouse([{ move: at(180), steps: 5 }]);
    await expect.element(slider).toHaveValue('170');
    // Held there, it lets go of the default and takes the size under the pointer.
    await expect.element(slider, { timeout: 2000 }).toHaveValue('180');
    await commands.mouse([{ move: at(160), steps: 5 }]);
    await expect.element(slider).toHaveValue('160');
    await commands.mouse([{ up: true }]);
  });
});
