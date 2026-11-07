import { violations } from '#components/__tests__/axe';
import { renderApp } from '#components/__tests__/render';
import { expect, test } from 'vitest';

// On its own, as the welcome screen only shows until a test opens the folder.
test('the welcome screen has nothing for axe to point out', async () => {
  const { screen } = await renderApp({ open: false });
  await expect.element(screen.getByRole('button', { name: 'Choose a folder' })).toBeVisible();
  await expect(violations(screen.container)).resolves.toEqual([]);
});
