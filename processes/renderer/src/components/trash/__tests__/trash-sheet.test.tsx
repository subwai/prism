import { renderInLibrary } from '#components/__tests__/render';
import { TrashSheet } from '#components/trash/trash-sheet';
import { fakeAPI, fakeTrashAPI } from '#data/__tests__/fixtures';
import { viewSpec } from '#data/urls';
import type {
  PhotoEntry,
  TrashChoices,
  TrashDecision,
  TrashPlan,
  TrashReason,
  TrashRow,
} from '@prism/shared';
import { expect, test } from 'vitest';
import { userEvent } from 'vitest/browser';

const NO_COUNTS = { files: 0, folders: 0, photos: 0, size: 0, videos: 0 };
const NO_ENTRY = {
  id: '',
  kind: 'file' as const,
  modifiedMs: 1,
  name: '',
  parentId: '.',
  size: 1000,
};

/** The decisions a row offers, as the planner has them. */
function optionsOf(reason: TrashReason, kind: PhotoEntry['kind']): TrashDecision[] {
  if (reason === 'conflict') {
    return ['keep', 'rescue', 'trash'];
  }
  return kind === 'directory' ? ['keep', 'only', 'trash'] : ['keep', 'trash'];
}

/** A row of the plan, decided as `choices` say, or else by `fallback`. */
function row(
  choices: TrashChoices,
  id: string,
  reason: TrashReason,
  fallback: TrashDecision,
  kind: PhotoEntry['kind'] = 'image',
): TrashRow {
  const chosen = choices.decisions[id];
  const parentId = id.includes('/') ? id.slice(0, id.lastIndexOf('/')) : '.';
  return {
    attachments: [],
    changed: chosen !== undefined && chosen !== fallback,
    conflicts: 0,
    contents: { ...NO_COUNTS, photos: 1, size: 1000 },
    decision: chosen ?? fallback,
    entry: { id, kind, modifiedMs: 1, name: id.split('/').at(-1) ?? id, parentId, size: 1000 },
    options: optionsOf(reason, kind),
    reason,
  };
}

/** A 1-star folder holding a 5-star photo, and a 2-star photo beside it, as `choices` decide. */
function planOf(choices: TrashChoices): TrashPlan {
  return {
    groups: [
      {
        folderId: '.',
        rows: [
          row(choices, 'bad', 'matches', 'trash', 'directory'),
          row(choices, 'poor.jpg', 'matches', 'trash'),
        ],
      },
      {
        folderId: 'bad',
        rows: [row(choices, 'bad/good.jpg', 'conflict', choices.defaults.conflict)],
      },
    ],
    moves: [],
    rescued: NO_COUNTS,
    targets: [],
    totals: { ...NO_COUNTS, photos: 2, size: 2000 },
  };
}

async function renderSheet() {
  const api = fakeAPI([]);
  const trash = fakeTrashAPI();
  trash.viewTrashPlan.mockImplementation((_viewId, _version, choices) =>
    Promise.resolve(planOf(choices)),
  );
  trash.viewTrashFiles.mockImplementation((_viewId, _version, choices) => {
    const entries = new Map(
      planOf(choices)
        .groups.flatMap((group) => group.rows)
        .map((each) => [each.entry.id, each.entry]),
    );
    const entry = (id: string) =>
      entries.get(id) ?? { ...NO_ENTRY, id, name: id.split('/').at(-1) ?? id, parentId: 'bad' };
    const rescued = choices.decisions['bad/good.jpg'] === 'rescue';
    return Promise.resolve({
      moved: rescued ? [{ entry: entry('bad/good.jpg'), to: '.' }] : [],
      trashed: [
        { entry: entry('bad/plain.jpg') },
        { entry: entry('bad/plain.xmp'), owner: 'plain.jpg' },
        { entry: entry('poor.jpg') },
      ],
    });
  });
  const spec = viewSpec(new URLSearchParams('rating=max2'), 'grid', '.');
  const rendered = await renderInLibrary(
    <TrashSheet spec={spec} folderName="Pictures" onClose={() => null} />,
    { api, height: 800, trash, width: 1200 },
  );
  /** The choices the plan was last asked to be made with. */
  const lastChoices = () => trash.viewTrashPlan.mock.lastCall?.[2];
  return { ...rendered, api, lastChoices, trash };
}

test('the sheet lists what goes under each folder, from a view of everything inside it', async () => {
  const { screen, api } = await renderSheet();
  await expect
    .element(screen.getByRole('heading', { name: /≤ 2 stars in “Pictures”/u }))
    .toBeVisible();
  await expect.element(screen.getByText('poor.jpg')).toBeVisible();
  await expect.element(screen.getByText('Rated, but its folder matches')).toBeVisible();
  // Each row shows how it stands against the filter the plan is of: here, its rating.
  await expect.element(screen.getByText('Unrated').first()).toBeVisible();
  expect(api.openView).toHaveBeenCalledWith(
    expect.objectContaining({ recursive: true, show: 'all' }),
  );
});

test('each row is decided in one click, and resetting by the defaults takes it back', async () => {
  const { screen, lastChoices } = await renderSheet();
  const good = screen.getByRole('group', { name: 'What becomes of good.jpg' });
  await good.getByRole('button', { name: 'Rescue' }).click();
  await expect.poll(lastChoices).toMatchObject({ decisions: { 'bad/good.jpg': 'rescue' } });
  await expect.element(screen.getByText('1 by hand')).toBeVisible();
  // Reset stays while rows are selected, as the bar at the foot then decides them.
  await screen.getByRole('checkbox', { name: 'Select poor.jpg' }).click();
  const reset = screen.getByRole('button', { name: 'Reset to defaults' });
  await reset.click();
  const keep = good.getByRole('button', { name: 'Keep' });
  await expect.element(keep).toHaveAttribute('aria-pressed', 'true');
  await expect.element(reset).not.toBeInTheDocument();
});

test('rows selected are decided together, from the bar or the keys', async () => {
  const { screen, lastChoices } = await renderSheet();
  await screen.getByRole('checkbox', { name: 'Select poor.jpg' }).click();
  await screen.getByRole('checkbox', { name: 'Select good.jpg' }).click();
  await screen.getByRole('button', { name: 'Keep 2' }).click();
  await expect
    .poll(lastChoices)
    .toMatchObject({ decisions: { 'bad/good.jpg': 'keep', 'poor.jpg': 'keep' } });

  await userEvent.keyboard('t');
  await expect
    .poll(lastChoices)
    .toMatchObject({ decisions: { 'bad/good.jpg': 'trash', 'poor.jpg': 'trash' } });
});

test('a default decides every row of its kind not decided by hand', async () => {
  const { screen, lastChoices } = await renderSheet();
  const conflicts = screen.getByRole('group', { name: 'Rated higher, inside matching folders' });
  await conflicts.getByRole('button', { name: 'Trash' }).click();
  await expect.poll(lastChoices).toMatchObject({ defaults: { conflict: 'trash' } });
  await expect
    .element(
      screen
        .getByRole('group', { name: 'What becomes of good.jpg' })
        .getByRole('button', { name: 'Trash' }),
    )
    .toHaveAttribute('aria-pressed', 'true');
});

test('a tab narrows the rows to decide on, and says the rest stay as they are', async () => {
  const { screen } = await renderSheet();
  await screen.getByRole('button', { name: 'Needs a look 1' }).click();
  await expect.element(screen.getByText('good.jpg')).toBeVisible();
  await expect.element(screen.getByText('poor.jpg')).not.toBeInTheDocument();
  await expect.element(screen.getByText(/Showing 1 of 3 rows/u)).toBeVisible();
});

test('rows stay selected while a filter hides them, and are decided with the rest', async () => {
  const { screen, lastChoices } = await renderSheet();
  await screen.getByRole('checkbox', { name: 'Select poor.jpg' }).click();
  await screen.getByRole('button', { name: 'Needs a look 1' }).click();
  await screen.getByRole('checkbox', { name: 'Select good.jpg' }).click();
  await expect.element(screen.getByText('2 selected · 1 not shown')).toBeVisible();
  await screen.getByRole('button', { name: 'Keep 2' }).click();
  await expect
    .poll(lastChoices)
    .toMatchObject({ decisions: { 'bad/good.jpg': 'keep', 'poor.jpg': 'keep' } });
});

test('the rows filter as the gallery’s search does, its list opening over the sheet', async () => {
  const { screen } = await renderSheet();
  await screen.getByRole('combobox', { name: 'Filter rows' }).click();
  await screen.getByRole('option', { name: /Format/u }).click();
  await screen.getByRole('option', { name: /Folder/u }).click();
  await expect.element(screen.getByRole('button', { name: 'Remove Format: Folder' })).toBeVisible();
  await expect.element(screen.getByText('poor.jpg')).not.toBeInTheDocument();
  await expect.element(screen.getByText(/Showing 1 of 3 rows/u)).toBeVisible();
});

test('a row clicked selects it, again lets it go, and Shift picks a range without selecting text', async () => {
  const { screen } = await renderSheet();
  const poor = screen.getByText('poor.jpg');
  await poor.click();
  await expect.element(screen.getByText('1 selected')).toBeVisible();
  await poor.click();
  await expect.element(screen.getByText('1 selected')).not.toBeInTheDocument();
  await poor.click();
  await screen.getByText('good.jpg').click({ modifiers: ['Shift'] });
  await expect.element(screen.getByText('2 selected')).toBeVisible();
  expect(document.getSelection()?.toString()).toBe('');
});

test('a selection is decided any way one of its rows can be, Only matches for its folders', async () => {
  const { screen, lastChoices } = await renderSheet();
  await screen.getByRole('checkbox', { name: 'Select bad' }).click();
  await screen.getByRole('checkbox', { name: 'Select poor.jpg' }).click();
  await expect.element(screen.getByRole('button', { name: 'Keep 2' })).toBeVisible();
  await screen.getByRole('button', { name: 'Only matches 1' }).click();
  await expect.poll(lastChoices).toMatchObject({ decisions: { bad: 'only' } });
  expect(lastChoices()?.decisions).not.toHaveProperty(['poor.jpg']);
  await userEvent.keyboard('t');
  await userEvent.keyboard('o');
  await expect.poll(lastChoices).toMatchObject({ decisions: { bad: 'only', 'poor.jpg': 'trash' } });
});

test('every folder collapses and expands at once', async () => {
  const { screen } = await renderSheet();
  await screen.getByRole('button', { name: 'Collapse every folder' }).click();
  await expect.element(screen.getByText('poor.jpg')).not.toBeInTheDocument();
  await expect.element(screen.getByText('good.jpg')).not.toBeInTheDocument();
  await screen.getByRole('button', { name: 'Expand every folder' }).click();
  await expect.element(screen.getByText('good.jpg')).toBeVisible();
});

test('a folder’s heading collapses wherever it is clicked, and its checkbox selects its rows', async () => {
  const { screen, lastChoices } = await renderSheet();
  await screen.getByText('Pictures', { exact: true }).click();
  await expect.element(screen.getByText('poor.jpg')).not.toBeInTheDocument();
  await screen.getByText('Pictures', { exact: true }).click();
  await expect.element(screen.getByText('poor.jpg')).toBeVisible();
  // It says what its rows are decided as, rather than deciding them itself.
  await expect.element(screen.getByText('2 Trash')).toBeVisible();

  const every = screen.getByRole('checkbox', { name: 'Select every row inside Pictures' });
  await screen.getByRole('checkbox', { name: 'Select poor.jpg' }).click();
  // Half-filled while some of its rows are selected.
  await expect.poll(() => (every.element() as HTMLInputElement).indeterminate).toBe(true);
  await every.click();
  await expect.element(every).toBeChecked();
  await expect.element(screen.getByText('2 selected')).toBeVisible();
  await screen.getByRole('button', { name: 'Only matches 1' }).click();
  await expect.poll(lastChoices).toMatchObject({ decisions: { bad: 'only' } });
  await expect.element(screen.getByText('1 Only matches · 1 Trash')).toBeVisible();
  await every.click();
  await expect.element(screen.getByText('2 selected')).not.toBeInTheDocument();
});

test('Files lists every file that goes, one by one, and what moves out instead', async () => {
  const { screen, trash } = await renderSheet();
  await screen
    .getByRole('group', { name: 'What becomes of good.jpg' })
    .getByRole('button', { name: 'Rescue' })
    .click();
  await screen.getByRole('button', { name: 'Files' }).click();
  await expect.element(screen.getByText('To the Trash · 3')).toBeVisible();
  await expect.element(screen.getByText('Sidecar of plain.jpg')).toBeVisible();
  // Each shows how it stands against the filter the plan is of: here, its rating.
  await expect.element(screen.getByText('Unrated').first()).toBeVisible();
  await expect.element(screen.getByText('Moved out first · 1')).toBeVisible();
  await expect.element(screen.getByText('Moves to the top folder')).toBeVisible();
  await expect
    .element(
      screen.getByText(/3 to the Trash · 1 moved out · everything else in “Pictures” stays/u),
    )
    .toBeVisible();
  expect(trash.viewTrashFiles.mock.lastCall?.[2]).toMatchObject({
    decisions: { 'bad/good.jpg': 'rescue' },
  });
  await screen.getByRole('button', { name: 'Decide' }).click();
  await expect.element(screen.getByText('Rated, but its folder matches')).toBeVisible();
});

test('the info button explains how it works with the plan’s own rows, and again goes back', async () => {
  const { screen } = await renderSheet();
  const info = screen.getByRole('button', { name: 'How this works' });
  await info.click();
  await expect
    .element(screen.getByRole('heading', { name: 'Rated, but its folder matches' }))
    .toBeVisible();
  await expect.element(screen.getByText('1 row in this plan, such as “good.jpg”.')).toBeVisible();
  await expect.element(screen.getByText(/Select poor.jpg/u)).not.toBeInTheDocument();
  await info.click();
  await expect.element(screen.getByRole('checkbox', { name: 'Select poor.jpg' })).toBeVisible();
});
