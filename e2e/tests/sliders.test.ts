import { openFolder, test } from '#support/fixtures';
import { describe, expect } from 'vitest';

describe('size sliders', () => {
  test('go back to their default size on a double-click', async ({ page }) => {
    await openFolder(page);
    for (const { name, size, max } of [
      { max: '240', name: 'Thumbnail size', size: '170' },
      { max: '64', name: 'Folder cover size', size: '32' }
    ]) {
      const slider = page.getByRole('slider', { name });
      await expect(slider.inputValue()).resolves.toBe(size);
      await slider.fill(max);
      await expect(slider.inputValue()).resolves.toBe(max);
      await slider.dblclick();
      await expect(slider.inputValue()).resolves.toBe(size);
    }
  });

  test('snap to their default size while dragging, until held there', async ({ page }) => {
    await openFolder(page);
    const slider = page.getByRole('slider', { name: 'Thumbnail size' });
    const box = await slider.boundingBox();
    if (!box) {
      throw new Error('The slider is not on screen');
    }
    // Where the thumb's centre is at a size, from 110 to 240; it is 15px wide.
    const at = (size: number) => box.x + 7.5 + ((size - 110) / 130) * (box.width - 15);
    const middle = box.y + box.height / 2;
    await page.mouse.move(at(230), middle);
    await page.mouse.down();
    await expect(slider.inputValue()).resolves.toBe('230');
    await page.mouse.move(at(180), middle, { steps: 5 });
    await expect(slider.inputValue()).resolves.toBe('170');
    // Held there, it lets go of the default and takes the size under the pointer.
    await expect.poll(() => slider.inputValue(), { timeout: 2000 }).toBe('180');
    await page.mouse.move(at(160), middle, { steps: 5 });
    await expect(slider.inputValue()).resolves.toBe('160');
    await page.mouse.up();
  });
});
