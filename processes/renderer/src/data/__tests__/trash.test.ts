import {
  confirmLabel,
  decideRows,
  destinationLine,
  filteredValues,
  narrowedBy,
  placeOf,
  reasonLabel,
  theTrash,
  trashAction,
  trashButtonLabel,
  trashSpecOf,
  withDefault,
} from '#data/trash';
import { linesOf, NO_SHEET_FILTER, rowsShown, sheetGroups, tabCounts } from '#data/trash-filters';
import { NO_SELECTION, selectAll, selectRow, selectRows } from '#data/trash-selection';
import { viewSpec } from '#data/urls';
import {
  emptyFilter,
  noTrashChoices,
  type PhotoEntry,
  type PhotoFilter,
  type TrashDecision,
  type TrashPlace,
  type TrashPlan,
  type TrashReason,
  type TrashRow,
} from '@prism/shared';
import { expect, test } from 'vitest';

const NO_COUNTS = { files: 0, folders: 0, photos: 0, size: 0, videos: 0 };

function row(
  id: string,
  reason: TrashReason,
  decision: TrashDecision,
  {
    kind = 'image' as PhotoEntry['kind'],
    changed = false,
    rating = undefined as 1 | 5 | undefined,
  } = {},
): TrashRow {
  const parentId = id.includes('/') ? id.slice(0, id.lastIndexOf('/')) : '.';
  const options: TrashDecision[] =
    reason === 'conflict' ? ['keep', 'rescue', 'trash'] : ['keep', 'trash'];
  return {
    attachments: [],
    changed,
    conflicts: 0,
    contents: NO_COUNTS,
    decision,
    entry: { id, kind, modifiedMs: 1, name: id.split('/').at(-1) ?? id, parentId, rating, size: 1 },
    options,
    reason,
  };
}

const PLAN: TrashPlan = {
  groups: [
    {
      folderId: '.',
      rows: [
        row('bad', 'matches', 'trash', { kind: 'directory' }),
        row('poor.jpg', 'matches', 'trash'),
      ],
    },
    {
      folderId: 'bad',
      rows: [
        {
          ...row('bad/good.jpg', 'conflict', 'keep', { rating: 5 }),
          entry: {
            ...row('bad/good.jpg', 'conflict', 'keep', { rating: 5 }).entry,
            exif: { camera: 'X100V', tags: ['beach'] },
          },
        },
        row('bad/fine.jpg', 'conflict', 'trash', { changed: true }),
      ],
    },
  ],
  moves: [],
  rescued: NO_COUNTS,
  targets: [],
  totals: NO_COUNTS,
};

const filterOf = (narrowed: Partial<PhotoFilter>) => ({ ...emptyFilter(), ...narrowed });

const ids = (rows: TrashRow[]) => rows.map((each) => each.entry.id);

test('a plan is of everything inside the folder, folders included, narrowed as the view is', () => {
  const spec = viewSpec(
    new URLSearchParams('rating=max2&q=beach&order=desc&sort=size'),
    'grid',
    'Trips',
  );
  expect(trashSpecOf(spec)).toMatchObject({
    descending: false,
    directoryId: 'Trips',
    recursive: true,
    search: 'beach',
    show: 'all',
    sort: 'name',
  });
  expect(narrowedBy(spec)).toBe('“beach”, ≤ 2 stars');
});

test('what goes shows its values of the fields the filter narrows by, tags only those asked for', () => {
  const entry = {
    ...row('bad/good.jpg', 'conflict', 'keep').entry,
    exif: { camera: 'X100V', tags: ['beach', 'sea'] },
    rating: 2 as const,
  };
  expect(filteredValues(entry, filterOf({}))).toEqual([]);
  expect(filteredValues(entry, filterOf({ rating: ['max2'], tag: ['sea'] }))).toEqual([
    { field: 'rating', text: '★★' },
    { field: 'tag', text: 'sea' },
  ]);
  expect(
    filteredValues(
      { ...entry, rating: undefined },
      filterOf({ camera: ['X100V'], rating: ['unrated'] }),
    ),
  ).toEqual([
    { field: 'rating', text: 'Unrated' },
    { field: 'camera', text: 'X100V' },
  ]);
});

test('rows are decided only as they can be', () => {
  const rows = PLAN.groups.flatMap((group) => group.rows);
  expect(decideRows(noTrashChoices(), rows, 'rescue').decisions).toEqual({
    'bad/fine.jpg': 'rescue',
    'bad/good.jpg': 'rescue',
  });
  expect(withDefault(noTrashChoices(), 'conflict', 'trash').defaults.conflict).toBe('trash');
});

test('the sheet lists rows under their folders, narrowed by tab, chips and text', () => {
  const lines = (filter = {}, collapsed = new Set<string>()) =>
    linesOf(PLAN, { ...NO_SHEET_FILTER, ...filter }, collapsed).map((line) =>
      line.type === 'folder' ? `# ${line.folderId}` : line.row.entry.id,
    );
  expect(lines()).toEqual(['# .', 'bad', 'poor.jpg', '# bad', 'bad/good.jpg', 'bad/fine.jpg']);
  expect(lines({ tab: 'look' })).toEqual(['# bad', 'bad/good.jpg', 'bad/fine.jpg']);
  expect(lines({ tab: 'keep' })).toEqual(['# bad', 'bad/good.jpg']);
  expect(lines({ tab: 'changed' })).toEqual(['# bad', 'bad/fine.jpg']);
  // The chips are the gallery's search's, a rating's as a range, with the sheet's own beside them.
  expect(lines({ tokens: [{ field: 'rating', value: 'min3' }] })).toEqual([
    '# bad',
    'bad/good.jpg',
  ]);
  expect(lines({ tokens: [{ field: 'format', value: 'Folder' }] })).toEqual(['# .', 'bad']);
  expect(lines({ tokens: [{ field: 'camera', value: 'X100V' }] })).toEqual([
    '# bad',
    'bad/good.jpg',
  ]);
  expect(lines({ tokens: [{ field: 'tag', value: 'beach' }] })).toEqual(['# bad', 'bad/good.jpg']);
  expect(lines({ tokens: [{ field: 'reason', value: 'matches' }] })).toEqual([
    '# .',
    'bad',
    'poor.jpg',
  ]);
  expect(lines({ query: 'POOR' })).toEqual(['# .', 'poor.jpg']);
  // A collapsed folder shows its heading, and its rows count as shown, to select and decide.
  const collapsed = linesOf(PLAN, NO_SHEET_FILTER, new Set(['bad']));
  expect(lines({}, new Set(['bad']))).toEqual(['# .', 'bad', 'poor.jpg', '# bad']);
  expect(ids(rowsShown(collapsed))).toEqual(['bad', 'poor.jpg', 'bad/good.jpg', 'bad/fine.jpg']);
  expect(tabCounts(PLAN.groups.flatMap((group) => group.rows))).toMatchObject({
    all: 4,
    changed: 1,
    keep: 1,
    look: 2,
    rescue: 0,
    trash: 3,
  });
});

test('the sheet offers what the gallery’s search does, counted among its rows', () => {
  const groups = sheetGroups(PLAN.groups.flatMap((group) => group.rows));
  const rating = groups.find((group) => group.field === 'rating');
  expect(rating?.values).toEqual([
    { count: 1, value: 'min5' },
    { count: 1, value: 'min4' },
    { count: 1, value: 'min3' },
    { count: 1, value: 'min2' },
    { count: 1, value: 'min1' },
    { count: 3, value: 'unrated' },
  ]);
  expect(rating?.format?.('min3')).toBe('≥ 3 stars');
  expect(groups.map((group) => group.label)).toEqual([
    'Format',
    'Rating',
    'Camera',
    'Lens',
    'Tag',
    'Why',
    'Folder',
  ]);
});

test('rows select alone, with Command one at a time, with Shift a range, and all kept hidden', () => {
  const shown = ['a', 'b', 'c', 'd'];
  const one = selectRow(NO_SELECTION, 'b', shown);
  expect([...one.ids]).toEqual(['b']);
  expect(selectRow(one, 'b', shown)).toBe(NO_SELECTION);
  const two = selectRow(one, 'd', shown, { toggle: true });
  expect([...two.ids]).toEqual(['b', 'd']);
  expect([...selectRow(two, 'b', shown, { toggle: true }).ids]).toEqual(['d']);
  expect([...selectRow(one, 'd', shown, { extend: true }).ids].toSorted()).toEqual(['b', 'c', 'd']);
  // A folder's heading selects all its rows, or takes them all out.
  expect([...selectRows(one, ['c', 'd'], true).ids]).toEqual(['b', 'c', 'd']);
  expect([...selectRows(two, ['b', 'c'], false).ids]).toEqual(['d']);
  expect([...selectAll(selectRow(NO_SELECTION, 'x', ['x']), shown).ids]).toEqual(['x', ...shown]);
});

test('each row says why it is in the plan', () => {
  expect(reasonLabel(row('bad/good.jpg', 'conflict', 'keep'))).toBe(
    'Rated, but its folder matches',
  );
  expect(
    reasonLabel({
      ...row('trip', 'empty', 'trash', { kind: 'directory' }),
      contents: { ...NO_COUNTS, photos: 12 },
    }),
  ).toBe('Left empty · 12 photos');
});

test('a network share’s runs go to Prism’s Trash, named so wherever they are told of', () => {
  expect(placeOf('local')).toEqual({ destination: 'system' });
  expect(placeOf('network')).toEqual({ destination: 'prism' });
  const system = placeOf('local');
  const prism: TrashPlace = { destination: 'prism', share: 'DataShare' };
  expect([trashButtonLabel(system), trashAction(system), theTrash('system')]).toEqual([
    'Move matches to Trash',
    'Move to Trash',
    'the Trash',
  ]);
  expect([destinationLine(system), confirmLabel(system, 1200)]).toEqual([
    'Moves to the Trash.',
    'Move 1,200 to Trash',
  ]);
  expect([trashButtonLabel(prism), trashAction(prism), theTrash('prism')]).toEqual([
    'Move matches to Prism’s Trash on DataShare',
    'Move to Prism’s Trash',
    'Prism’s Trash',
  ]);
  expect([destinationLine(prism), confirmLabel(prism, 411)]).toEqual([
    'Moves to Prism’s Trash on DataShare, as it has no Trash of its own.',
    'Move 411 to Prism’s Trash',
  ]);
});

test('where Prism can keep no Trash, every place that tells of a run says it deletes for good', () => {
  const place: TrashPlace = { blocked: 'read-only', destination: 'delete', share: 'DataShare' };

  expect([trashButtonLabel(place), trashAction(place), confirmLabel(place, 411)]).toEqual([
    'Delete matches permanently',
    'Delete permanently',
    'Delete 411 permanently',
  ]);
  expect(destinationLine(place)).toBe(
    'Deletes permanently. DataShare has no Trash, and Prism can’t keep one there (read-only).',
  );
});
