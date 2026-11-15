import { treeRows } from '#components/folder-tree/tree-rows';
import {
  EMPTY_TREE,
  foldersWithSubfolders,
  withSkeleton,
  withSubfolders,
} from '#data/folder-skeleton';
import type { PhotoFolder } from '@prism/shared';
import { expect, test } from 'vitest';

const root: PhotoFolder = { id: '.', name: 'Pictures' };

/** Album holds Kids; Trips holds Beach, which holds Shore. */
const tree = withSkeleton(EMPTY_TREE, {
  covers: [],
  folders: [
    ['Album', '.', 'Album', null],
    ['Album/Kids', 'Album', 'Kids', null],
    ['Trips/Beach', 'Trips', 'Beach', null],
    ['Trips/Beach/Shore', 'Trips/Beach', 'Shore', null],
    ['Trips', '.', 'Trips', null],
  ],
  listed: ['.', 'Album', 'Trips', 'Trips/Beach'],
  root: [null, true],
});

/** The rows' folders, indented by depth. */
function shown(state: typeof tree, trail: PhotoFolder[] = [root]) {
  return treeRows(state, root, trail).rows.map(
    (row) => `${'  '.repeat(row.depth)}${row.entry.name} ${row.position}/${row.siblings}`,
  );
}

test('the root shows its folders, and each open folder its own', () => {
  expect(shown(tree)).toEqual(['Pictures 1/1', '  Album 1/2', '  Trips 2/2']);
  const opened = { ...tree, opened: new Map([['Trips', true]]) };
  expect(shown(opened)).toEqual(['Pictures 1/1', '  Album 1/2', '  Trips 2/2', '    Beach 1/1']);
  // Closing a folder hides what is inside it, however far it was opened.
  const closed = {
    ...tree,
    opened: new Map([
      ['Trips', false],
      ['Trips/Beach', true],
    ]),
  };
  expect(shown(closed)).toEqual(['Pictures 1/1', '  Album 1/2', '  Trips 2/2']);
});

test("the root's row has the library's folder's tile, as the catalog's skeleton has it", () => {
  const covered = withSkeleton(EMPTY_TREE, {
    covers: [[['Trips/a.jpg', 'image', 50, 1000, null]]],
    folders: [['Trips', '.', 'Trips', [true, false, 0]]],
    listed: ['.', 'Trips'],
    root: [[true, true, 0], true],
  });
  const [row] = treeRows(covered, root, [root]).rows;
  expect(row?.entry.summary).toMatchObject({ hasEntries: true, hasSubfolders: true, read: true });
  expect(row?.entry.summary?.covers.map((cover) => cover.id)).toEqual(['Trips/a.jpg']);
  // Reading some folders' subfolders again reads the root's tile again too.
  const emptied = withSubfolders(covered, ['.'], {
    covers: [],
    folders: [],
    listed: [],
    root: [[false, false, -1], true],
  });
  expect(treeRows(emptied, root, [root]).rows[0]?.entry.summary).toEqual({
    covers: [],
    hasEntries: false,
    hasSubfolders: false,
    read: true,
  });
});

test('the folders holding the current one start open', () => {
  const trail = [root, { id: 'Trips', name: 'Trips' }, { id: 'Trips/Beach', name: 'Beach' }];
  expect(shown(tree, trail)).toEqual([
    'Pictures 1/1',
    '  Album 1/2',
    '  Trips 2/2',
    '    Beach 1/1',
  ]);
  const { indexOf, expanded } = treeRows(tree, root, trail);
  expect(indexOf('Trips/Beach')).toBe(3);
  expect(indexOf('Album/Kids')).toBe(-1);
  // The current folder itself stays as it was left.
  expect(expanded('Trips/Beach')).toBe(false);
});

test('expanding all opens every folder known to hold folders, a level at a time', () => {
  const ids = foldersWithSubfolders(tree, root.id);
  expect(ids).toEqual(['Album', 'Trips', 'Trips/Beach']);
  const opened = { ...tree, opened: new Map(ids.map((id) => [id, true])) };
  expect(shown(opened)).toEqual([
    'Pictures 1/1',
    '  Album 1/2',
    '    Kids 1/1',
    '  Trips 2/2',
    '    Beach 1/1',
    '      Shore 1/1',
  ]);
});

test("a folder's subfolders are replaced whole, and those gone take theirs along", () => {
  const opened = {
    ...tree,
    opened: new Map([
      ['Trips', true],
      ['Trips/Beach', true],
      ['Trips/Bay', true],
    ]),
  };
  // Beach was renamed Bay: the catalog lists Bay, but has not read it yet.
  const renamed = withSubfolders(opened, ['Trips'], {
    covers: [],
    folders: [['Trips/Bay', 'Trips', 'Bay', null]],
    listed: [],
    root: [null, true],
  });
  expect(shown(renamed)).toEqual(['Pictures 1/1', '  Album 1/2', '  Trips 2/2', '    Bay 1/1']);
  expect(renamed.children.has('Trips/Beach')).toBe(false);
  // A folder asked about that now holds none.
  const emptied = withSubfolders(renamed, ['Album', 'Trips'], {
    covers: [],
    folders: [['Trips/Bay', 'Trips', 'Bay', null]],
    listed: [],
    root: [null, true],
  });
  expect(emptied.children.has('Album')).toBe(false);
  expect(shown(emptied)).toEqual(['Pictures 1/1', '  Album 1/2', '  Trips 2/2', '    Bay 1/1']);
});
