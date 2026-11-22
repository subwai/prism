import { renderApp } from '#components/__tests__/render';
import type { PhotoRoot } from '@prism/shared';
import { expect, test } from 'vitest';

test('a folder whose catalog is upgraded as it opens says so until it opens', async () => {
  const { api, screen } = await renderApp({ open: false });
  const { promise: opened, resolve: open } = Promise.withResolvers<PhotoRoot>();
  api.openFolder.mockReturnValue(opened);
  await screen.getByRole('button', { name: 'Choose a folder' }).click();
  // As the main process tells once the folder's worker starts upgrading, and once it is done.
  const [tellUpgrading] = api.onUpgrading.mock.lastCall ?? [];
  tellUpgrading?.(true);
  const notice = screen.getByRole('status').filter({ hasText: 'Updating the catalog…' });
  await expect.element(notice).toBeVisible();
  tellUpgrading?.(false);
  open({ id: '.', location: 'local', name: 'Pictures', session: 'test' });
  await expect.element(screen.getByRole('option', { name: 'clip.webm' })).toBeVisible();
  await expect.element(notice).not.toBeInTheDocument();
});
