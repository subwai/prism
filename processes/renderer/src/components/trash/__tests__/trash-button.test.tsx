import { renderInLibrary } from '#components/__tests__/render';
import { TrashButton } from '#components/trash/trash-button';
import { fakeTrashAPI } from '#data/__tests__/fixtures';
import { expect, test } from 'vitest';
import { page } from 'vitest/browser';

test('the button names where matches go: the Trash, or Prism’s on a share', async () => {
  await renderInLibrary(<TrashButton onClick={() => null} />);
  await expect.element(page.getByRole('button', { name: 'Move matches to Trash' })).toBeVisible();

  const trash = fakeTrashAPI();
  trash.trashPlace.mockResolvedValue({ destination: 'prism', share: 'DataShare' });
  await renderInLibrary(<TrashButton onClick={() => null} />, { location: 'network', trash });
  await expect
    .element(page.getByRole('button', { name: 'Move matches to Prism’s Trash on DataShare' }))
    .toBeVisible();
});

test('where Prism can keep no Trash, the button says matches are deleted for good', async () => {
  const trash = fakeTrashAPI();
  trash.trashPlace.mockResolvedValue({ blocked: 'read-only', destination: 'delete' });
  await renderInLibrary(<TrashButton onClick={() => null} />, { location: 'network', trash });

  await expect
    .element(page.getByRole('button', { name: 'Delete matches permanently' }))
    .toBeVisible();
});
