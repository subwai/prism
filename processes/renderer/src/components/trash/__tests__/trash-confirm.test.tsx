import { renderInLibrary } from '#components/__tests__/render';
import { TrashSheet } from '#components/trash/trash-sheet';
import { TrashToast } from '#components/trash/trash-toast';
import { fakeAPI, fakeTrashAPI } from '#data/__tests__/fixtures';
import { viewSpec } from '#data/urls';
import type { TrashPlace, TrashPlan } from '@prism/shared';
import { useState } from 'react';
import { expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

const NO_COUNTS = { files: 0, folders: 0, photos: 0, size: 0, videos: 0 };

/** Two 2-star photos, which go. */
const PLAN: TrashPlan = {
  groups: [
    {
      folderId: '.',
      rows: ['a.jpg', 'b.jpg'].map((id) => ({
        attachments: [],
        changed: false,
        conflicts: 0,
        contents: { ...NO_COUNTS, photos: 1, size: 1000 },
        decision: 'trash' as const,
        entry: { id, kind: 'image' as const, modifiedMs: 1, name: id, parentId: '.', size: 1000 },
        options: ['keep' as const, 'trash' as const],
        reason: 'matches' as const,
      })),
    },
  ],
  moves: [],
  rescued: NO_COUNTS,
  targets: ['a.jpg', 'b.jpg'],
  totals: { ...NO_COUNTS, photos: 2, size: 2000 },
};

/** The sheet over the gallery, which closing takes away, as Back does, and the toast. */
function Gallery({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState(true);
  const spec = viewSpec(new URLSearchParams('rating=max2'), 'grid', '.');
  return (
    <>
      {open && (
        <TrashSheet
          spec={spec}
          folderName="Pictures"
          onClose={() => {
            onClose();
            setOpen(false);
          }}
        />
      )}
      <TrashToast />
    </>
  );
}

async function renderSheet(place?: TrashPlace) {
  const trash = fakeTrashAPI();
  trash.viewTrashPlan.mockResolvedValue(PLAN);
  if (place) {
    trash.trashPlace.mockResolvedValue(place);
  }
  const onClose = vi.fn();
  const rendered = await renderInLibrary(<Gallery onClose={onClose} />, {
    api: fakeAPI([]),
    height: 800,
    ...(place && { location: 'network' as const }),
    trash,
    width: 1200,
  });
  return { ...rendered, onClose, trash };
}

test('confirming moves the plan to the Trash, closes the sheet, and offers Undo', async () => {
  const { screen, onClose, trash } = await renderSheet();
  trash.trashView.mockResolvedValue({
    destination: 'system',
    moved: 0,
    runId: 'run',
    skipped: 0,
    trashed: 2,
  });
  trash.undoTrash.mockResolvedValue({ renamed: [], restored: 2 });

  await screen.getByRole('button', { name: 'Move 2 to Trash' }).click();

  await expect.element(page.getByText('Moved 2 items to the Trash')).toBeVisible();
  expect(trash.trashView).toHaveBeenCalledWith(
    expect.any(String),
    1,
    expect.objectContaining({ decisions: {} }),
    'system',
  );
  expect(onClose).toHaveBeenCalled();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect.element(page.getByText('Put back 2 items from the Trash')).toBeVisible();
  expect(trash.undoTrash).toHaveBeenCalledWith('run');
});

test('a run that can’t start says why in the sheet, which stays open', async () => {
  const { screen, onClose, trash } = await renderSheet();
  trash.trashView.mockResolvedValue({
    error: 'The folder changed since this was planned. Review it again.',
  });

  await screen.getByRole('button', { name: 'Move 2 to Trash' }).click();

  await expect
    .element(screen.getByRole('alert'))
    .toHaveTextContent('The folder changed since this was planned. Review it again.');
  expect(onClose).not.toHaveBeenCalled();
  await expect.element(screen.getByRole('button', { name: 'Move 2 to Trash' })).toBeEnabled();
});

test('a run that stops partway says so, and still offers Undo of what moved', async () => {
  const { screen, trash } = await renderSheet();
  trash.trashView.mockResolvedValue({
    destination: 'system',
    error: 'Couldn’t move “b.jpg” to the Trash: The share is gone.',
    moved: 0,
    runId: 'run',
    skipped: 0,
    trashed: 1,
  });

  await screen.getByRole('button', { name: 'Move 2 to Trash' }).click();

  const toast = page.getByRole('alert');
  await expect
    .element(
      toast.getByText(
        'Couldn’t move “b.jpg” to the Trash: The share is gone. 1 moved to the Trash before it stopped.',
      ),
    )
    .toBeVisible();
  await expect.element(toast.getByRole('button', { name: 'Undo' })).toBeVisible();
});

test('⌘Z puts back the last move, as a toast of its own says', async () => {
  const { screen, trash } = await renderSheet();
  trash.trashView.mockResolvedValue({
    destination: 'system',
    moved: 0,
    runId: 'run',
    skipped: 0,
    trashed: 2,
  });
  trash.undoTrash.mockResolvedValue({ renamed: [], restored: 2 });
  await screen.getByRole('button', { name: 'Move 2 to Trash' }).click();
  await expect.element(page.getByText('Moved 2 items to the Trash')).toBeVisible();

  await userEvent.keyboard('{Meta>}z{/Meta}');

  await expect.element(page.getByText('Put back 2 items from the Trash')).toBeVisible();
  expect(trash.undoTrash).toHaveBeenCalledWith('run');
  await userEvent.keyboard('{Meta>}z{/Meta}');
  expect(trash.undoTrash).toHaveBeenCalledTimes(1);
});

test('where Prism can keep no Trash, the sheet says it deletes for good, and asks first', async () => {
  const { screen, onClose, trash } = await renderSheet({
    blocked: 'read-only',
    destination: 'delete',
    share: 'DataShare',
  });
  trash.trashView.mockResolvedValue({
    destination: 'delete',
    moved: 0,
    runId: null,
    skipped: 0,
    trashed: 2,
  });

  await expect
    .element(screen.getByRole('heading', { name: 'Delete permanently — ≤ 2 stars in “Pictures”' }))
    .toBeVisible();
  await expect
    .element(
      screen.getByText(
        'Deletes permanently. DataShare has no Trash, and Prism can’t keep one there (read-only).',
      ),
    )
    .toBeVisible();
  const confirm = screen.getByRole('button', { name: 'Delete 2 permanently' });
  await expect.element(confirm).toBeDisabled();
  await screen.getByRole('checkbox', { name: 'I understand these can’t be recovered' }).click();
  await confirm.click();

  await expect.element(page.getByText('Deleted 2 items')).toBeVisible();
  expect(trash.trashView).toHaveBeenCalledWith(expect.any(String), 1, expect.anything(), 'delete');
  expect(onClose).toHaveBeenCalled();
  // What was deleted can't come back.
  await expect.element(page.getByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
});
