import { violations } from '#components/__tests__/axe';
import { renderApp } from '#components/__tests__/render';
import { describe, expect, onTestFinished, test } from 'vitest';
import { commands, userEvent } from 'vitest/browser';

/** Matches media features as a system setting would, until the test ends. */
async function emulate(media: Parameters<typeof commands.emulateMedia>[0]) {
  onTestFinished(() => commands.emulateMedia({ contrast: null, forcedColors: null }));
  await commands.emulateMedia(media);
}

function tertiary() {
  return getComputedStyle(document.documentElement).getPropertyValue('--color-label-tertiary');
}

describe('axe finds nothing to point out in', () => {
  test('the grid', async () => {
    const { screen } = await renderApp();
    await screen.getByRole('option', { name: 'landscape.jpg' }).click();
    await expect(violations(screen.container)).resolves.toEqual([]);
  });

  test('the filmstrip', async () => {
    const { screen } = await renderApp();
    await screen.getByRole('button', { name: 'Filmstrip view' }).click();
    await expect.element(screen.getByRole('listbox', { name: 'Photo filmstrip' })).toBeVisible();
    await expect(violations(screen.container)).resolves.toEqual([]);
  });

  test('the reader', async () => {
    const { screen } = await renderApp();
    await screen.getByRole('button', { name: 'Reader view' }).click();
    await expect
      .element(screen.getByRole('region', { name: 'Pages' }).getByRole('img').first())
      .toBeVisible();
    await expect(violations(screen.container)).resolves.toEqual([]);
  });

  test('a photo preview', async () => {
    const { screen } = await renderApp();
    await screen.getByRole('option', { name: 'landscape.jpg' }).click();
    await userEvent.keyboard('[Space]');
    await expect
      .element(screen.getByRole('dialog', { name: 'landscape.jpg' }).getByRole('img'))
      .toBeVisible();
    await expect(violations(screen.container)).resolves.toEqual([]);
  });

  test('the rename dialog, opened from the keyboard', async () => {
    const { screen } = await renderApp();
    await screen.getByRole('option', { name: 'landscape.jpg' }).click();
    await userEvent.keyboard('{F2}');
    await expect
      .element(screen.getByRole('dialog', { name: 'Rename “landscape.jpg”' }))
      .toBeVisible();
    await expect(violations(screen.container)).resolves.toEqual([]);
  });
});

describe('accessibility', () => {
  test('the viewer says which photo it moves to', async () => {
    const { screen } = await renderApp();
    await screen.getByRole('option', { name: 'landscape.jpg' }).click();
    await userEvent.keyboard('[Space]');
    const viewer = screen.getByRole('dialog').getByRole('region', { name: 'Image preview' });
    await expect.element(viewer.getByRole('img', { name: 'landscape.jpg' })).toBeVisible();
    await userEvent.keyboard('{ArrowRight}');
    // Videos count too, sorted by name before the photos.
    await expect
      .poll(() => viewer.element().querySelector('[aria-live="polite"]')?.textContent)
      .toBe('portrait.jpg, 4 of 5');
  });

  test('Increase Contrast strengthens the faintest labels', async () => {
    await renderApp();
    const normal = tertiary();
    await emulate({ contrast: 'more' });
    await expect.poll(tertiary).not.toBe(normal);
  });

  test('high contrast themes outline what is selected', async () => {
    const { screen } = await renderApp();
    const option = screen.getByRole('option', { name: 'landscape.jpg' });
    await option.click();
    await emulate({ forcedColors: 'active' });
    await expect.poll(() => getComputedStyle(option.element()).outlineStyle).toBe('solid');
  });

  test('controls tell screen readers their shortcuts', async () => {
    const { screen } = await renderApp();
    await expect
      .element(screen.getByRole('button', { name: 'Refresh folder' }))
      .toHaveAttribute('aria-keyshortcuts', 'Meta+R');
  });

  test('focus moves to the new view when the control that had it goes', async () => {
    const { screen } = await renderApp();
    // The view switch belongs to the view it replaces, so focus would otherwise be lost.
    await screen.getByRole('button', { name: 'Filmstrip view' }).click();
    await expect.element(screen.getByRole('listbox', { name: 'Photo filmstrip' })).toHaveFocus();
    await screen.getByRole('button', { name: 'Grid view' }).click();
    await expect.element(screen.getByRole('listbox', { name: 'Folder contents' })).toHaveFocus();
  });
});
