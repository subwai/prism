import { violations } from '#components/__tests__/axe';
import { renderApp } from '#components/__tests__/render';
import { tell } from '#data/__tests__/fixtures';
import { expect, test } from 'vitest';

test('a folder that goes away while open says so, and shows again once it is back', async () => {
  const { api, screen } = await renderApp();
  const photo = screen.getByRole('option', { name: 'clip.webm' });
  await expect.element(photo).toBeVisible();
  const listed = api.listFolder.getMockImplementation();
  // As the worker lists any folder once nothing is there, and the watcher says so.
  api.listFolder.mockResolvedValue({
    entries: [],
    error: 'ENOENT: no such file or directory',
    errors: [],
    missing: true,
  });
  tell(api, { changes: { changed: [], everything: true }, views: [] });
  await expect
    .element(screen.getByRole('heading', { name: 'This folder no longer exists' }))
    .toBeVisible();
  await expect.element(screen.getByText(/“Pictures” was moved, renamed or deleted/u)).toBeVisible();
  await expect.element(screen.getByRole('button', { name: 'Choose a folder' })).toBeVisible();
  expect(screen.getByText(/ENOENT/u).query()).toBeNull();
  await expect(violations(screen.container)).resolves.toEqual([]);
  if (listed) {
    api.listFolder.mockImplementation(listed);
  }
  tell(api, { changes: { changed: [], everything: true }, views: [] });
  await expect.element(photo).toBeVisible();
  expect(screen.getByRole('heading', { name: 'This folder no longer exists' }).query()).toBeNull();
});
