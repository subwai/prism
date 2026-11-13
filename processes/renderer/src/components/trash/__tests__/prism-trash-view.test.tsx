import { renderInLibrary } from '#components/__tests__/render';
import { PrismTrashRow } from '#components/folder-tree/prism-trash-row';
import { PrismTrashView } from '#components/trash/prism-trash-view';
import { fakeTrashAPI } from '#data/__tests__/fixtures';
import { prismTrashQuery } from '#data/prism-trash';
import type { PrismTrash } from '@prism/shared';
import { expect, test } from 'vitest';
import { page, userEvent } from 'vitest/browser';

const NO_COUNTS = { files: 0, folders: 0, photos: 0, size: 0, videos: 0 };

const TRASH: PrismTrash = {
  batches: [
    {
      id: '2026-11-12T14-03-22Z',
      items: 2,
      trashedAt: '2026-11-12T14:03:22.000Z',
      view: {
        filter: { camera: [], format: [], lens: [], rating: ['max2'], tag: [] },
        folder: 'Photos/2019',
        search: '',
      },
    },
    { id: '2026-11-10T09-00-00Z', items: 1, trashedAt: '2026-11-10T09:00:00.000Z' },
  ],
  share: 'DataShare',
};

async function renderTrash() {
  const trash = fakeTrashAPI();
  trash.prismTrash.mockResolvedValue(TRASH);
  trash.prismTrashContents.mockResolvedValue({ ...NO_COUNTS, photos: 12, size: 4_000_000 });
  const { library } = await renderInLibrary(<PrismTrashView />, {
    loader: ({ library: session }) => session.queries.ensureQueryData(prismTrashQuery(session)),
    location: 'network',
    trash,
  });
  return { library, trash };
}

test('lists the batches newest first, by what their runs were of and what they hold', async () => {
  await renderTrash();

  await expect
    .element(page.getByRole('heading', { name: 'Prism’s Trash on DataShare' }))
    .toBeVisible();
  const rows = page.getByRole('list', { name: 'Batches' }).getByRole('listitem');
  // What each holds is read after the list.
  await expect.poll(() => rows.nth(1).element().textContent).toContain('12 photos');
  expect(rows.nth(0).element().textContent).toContain('≤ 2 stars in Photos/2019 · 12 photos');
  // A batch made before Prism remembered its view says only what it holds.
  expect(rows.nth(1).element().textContent).not.toContain(' in ');
});

test('Put Back puts the batch back and says how many came back', async () => {
  const { trash } = await renderTrash();
  trash.putBackTrashBatch.mockResolvedValue({ renamed: ['beach (restored).jpg'], restored: 2 });

  await userEvent.click(page.getByRole('button', { name: 'Put Back' }).first());

  expect(trash.putBackTrashBatch).toHaveBeenCalledWith('2026-11-12T14-03-22Z');
  await expect
    .element(page.getByText('Put back 2 items · 1 under new names, as their places were taken'))
    .toBeVisible();
  // The list is read again, as what the batch held has gone back.
  expect(trash.prismTrash).toHaveBeenCalledTimes(2);
});

test('a batch is deleted for good only once confirmed', async () => {
  const { trash } = await renderTrash();

  await userEvent.click(page.getByRole('button', { name: 'Delete Permanently…' }).first());
  const dialog = page.getByRole('dialog', { name: 'Delete this batch permanently?' });
  await expect.element(dialog).toBeVisible();
  await userEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
  expect(trash.deleteTrashBatch).not.toHaveBeenCalled();

  await userEvent.click(page.getByRole('button', { name: 'Delete Permanently…' }).first());
  await userEvent.click(
    page.getByRole('dialog').getByRole('button', { name: 'Delete Permanently' }),
  );

  await expect.poll(() => trash.deleteTrashBatch.mock.calls).toEqual([['2026-11-12T14-03-22Z']]);
});

test('Empty Trash deletes everything in it once confirmed', async () => {
  const { trash } = await renderTrash();

  await userEvent.click(page.getByRole('button', { name: 'Empty Trash…' }));
  const dialog = page.getByRole('dialog', { name: 'Empty Prism’s Trash on DataShare?' });
  await userEvent.click(dialog.getByRole('button', { name: 'Empty Trash' }));

  await expect.poll(() => trash.emptyPrismTrash.mock.calls.length).toBe(1);
});

test('an empty Trash says where moves to the Trash go', async () => {
  const trash = fakeTrashAPI();
  trash.prismTrash.mockResolvedValue({ batches: [], share: 'DataShare' });
  await renderInLibrary(<PrismTrashView />, {
    loader: ({ library }) => library.queries.ensureQueryData(prismTrashQuery(library)),
    location: 'network',
    trash,
  });

  await expect.element(page.getByRole('heading', { name: 'Prism’s Trash is empty' })).toBeVisible();
  await expect.element(page.getByRole('button', { name: 'Empty Trash…' })).not.toBeInTheDocument();
});

test('the sidebar shows Prism’s Trash on a share once it holds anything', async () => {
  const trash = fakeTrashAPI();
  trash.prismTrash.mockResolvedValue(TRASH);
  await renderInLibrary(<PrismTrashRow />, { location: 'network', trash });

  await expect
    .element(page.getByRole('link', { name: /Prism’s Trash/u }))
    .toHaveAttribute('href', '/library/trash');
});

test('the sidebar shows no Trash of Prism’s off a share, nor an empty one', async () => {
  const trash = fakeTrashAPI();
  trash.prismTrash.mockResolvedValue({ batches: [], share: 'DataShare' });
  await renderInLibrary(<PrismTrashRow />, { location: 'network', trash });
  await expect.poll(() => trash.prismTrash.mock.calls.length).toBe(1);
  await expect.element(page.getByRole('link', { name: /Prism’s Trash/u })).not.toBeInTheDocument();

  const local = fakeTrashAPI();
  await renderInLibrary(<PrismTrashRow />, { trash: local });
  expect(local.prismTrash).not.toHaveBeenCalled();
});
