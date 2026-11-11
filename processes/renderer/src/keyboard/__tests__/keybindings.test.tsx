import { renderApp, saveKeybindings } from '#components/__tests__/render';
import { describe, expect, test } from 'vitest';
import { userEvent } from 'vitest/browser';

// Reading the file, and the menus' shortcuts, are the main process's, which the end-to-end
// tests cover; these cover what the window makes of what it reads.
describe('keybindings.json', () => {
  test('rules take effect in the keys as the file is saved', async () => {
    const { screen } = await renderApp();
    await screen.getByRole('option', { name: 'landscape.jpg' }).click();
    await userEvent.keyboard('[Space]');
    const viewer = screen.getByRole('region', { name: 'Image preview' });
    await expect.element(viewer.getByRole('img', { name: 'landscape.jpg' })).toBeVisible();
    saveKeybindings([{ command: 'next', key: 'n', when: 'viewerFocus' }]);
    await userEvent.keyboard('n');
    await expect.element(viewer.getByRole('img', { name: 'portrait.jpg' })).toBeVisible();
  });

  test('a file that does not parse is pointed out, and the keys keep working', async () => {
    const { screen } = await renderApp();
    saveKeybindings(null, 'CommaExpected on line 1');
    await expect
      .element(screen.getByText(/^keybindings\.json: CommaExpected on line 1/u))
      .toBeVisible();
    await screen.getByRole('option', { name: 'landscape.jpg' }).click();
    await userEvent.keyboard('[Space]');
    await expect.element(screen.getByRole('dialog')).toBeVisible();
  });

  test('a rule that cannot be used is pointed out', async () => {
    const { screen } = await renderApp();
    saveKeybindings([{ command: 'nxt', key: 'n' }]);
    await expect
      .element(screen.getByText(/^keybindings\.json: Rule 1: unknown command "nxt"/u))
      .toBeVisible();
  });
});
