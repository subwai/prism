import { ancestorsOf, treeRows, withOpened } from '#components/folder-tree/tree-rows';
import { skeletonOf } from '#data/__tests__/skeletons';
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
const tree = withSkeleton(
  EMPTY_TREE,
  skeletonOf([
    ['Album', '.', 'Album', null],
    ['Album/Kids', 'Album', 'Kids', null],
    ['Trips/Beach', 'Trips', 'Beach', null],
    ['Trips/Beach/Shore', 'Trips/Beach', 'Shore', null],
    ['Trips', '.', 'Trips', null],
  ]),
);

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
  const covered = withSkeleton(
    EMPTY_TREE,
    skeletonOf([['Trips', '.', 'Trips', [true, false, 0, true]]], {
      covers: [[['Trips/a.jpg', 'image', 50, 1000, null]]],
      root: [true, true, 0, true],
    }),
  );
  const [row] = treeRows(covered, root, [root]).rows;
  expect(row?.entry.summary).toMatchObject({ hasEntries: true, hasSubfolders: true, read: true });
  expect(row?.entry.summary?.covers.map((cover) => cover.id)).toEqual(['Trips/a.jpg']);
  // Reading some folders' subfolders again reads the root's tile again too.
  const emptied = withSubfolders(
    covered,
    ['.'],
    skeletonOf([], { root: [false, false, -1, true] }),
  );
  expect(treeRows(emptied, root, [root]).rows[0]?.entry.summary).toMatchObject({
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

test('a folder can open while it may hold folders, and an open one close until read', () => {
  const tiles = withSkeleton(
    EMPTY_TREE,
    skeletonOf([
      ['Album', '.', 'Album', [true, true, -1, true]],
      ['Kids', '.', 'Kids', [true, false, -1, true]],
      ['Trips', '.', 'Trips', null],
      ['Shore', '.', 'Shore', null],
      ['Trips/Beach', 'Trips', 'Beach', null],
    ]),
  );
  function answers(state: typeof tiles) {
    const { rows, expandable } = treeRows(state, root, [root]);
    return Object.fromEntries(rows.map((row) => [row.entry.name, expandable(row)]));
  }
  // Read, with folders inside and without; not read, as far as the tree knows its folders.
  expect(answers(tiles)).toEqual({
    Album: true,
    Kids: false,
    Pictures: true,
    Shore: false,
    Trips: true,
  });
  // An open folder not read yet can be closed, though the tree knows no folders inside it, but
  // one read without folders inside has nothing to close.
  const opened = {
    ...tiles,
    opened: new Map([
      ['Kids', true],
      ['Shore', true],
    ]),
  };
  expect(answers(opened)).toMatchObject({ Kids: false, Shore: true });
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
  const renamed = withSubfolders(
    opened,
    ['Trips'],
    skeletonOf([['Trips/Bay', 'Trips', 'Bay', null]]),
  );
  expect(shown(renamed)).toEqual(['Pictures 1/1', '  Album 1/2', '  Trips 2/2', '    Bay 1/1']);
  expect(renamed.children.has('Trips/Beach')).toBe(false);
  // A folder asked about that now holds none.
  const emptied = withSubfolders(
    renamed,
    ['Album', 'Trips'],
    skeletonOf([['Trips/Bay', 'Trips', 'Bay', null]]),
  );
  expect(emptied.children.has('Album')).toBe(false);
  expect(shown(emptied)).toEqual(['Pictures 1/1', '  Album 1/2', '  Trips 2/2', '    Bay 1/1']);
});

test('the tree remembers only folders opened, and those holding the current folder closed', () => {
  const trail = [root, { id: 'Trips', name: 'Trips' }, { id: 'Trips/Beach', name: 'Beach' }];
  const ancestors = ancestorsOf(root, trail);
  const opened = withOpened(
    new Map(),
    [
      ['Album', true],
      ['Trips', false],
      ['Album/Kids', false],
    ],
    ancestors,
  );
  // Kids starts closed anyway, so closing it changes nothing to remember.
  expect(opened).toEqual(
    new Map([
      ['Album', true],
      ['Trips', false],
    ]),
  );
  // Closing a folder opened by hand forgets it, and the tree shows it as it did.
  const closed = withOpened(opened, [['Album', false]], ancestors);
  expect(closed).toEqual(new Map([['Trips', false]]));
  expect(shown({ ...tree, opened: closed }, trail)).toEqual(
    shown({ ...tree, opened: new Map([...opened, ['Album', false]]) }, trail),
  );
});

test('what an earlier session remembered closed is forgotten with the next change', () => {
  // As Collapse All left it after Expand All: every folder the tree knew, closed.
  const saved = new Map([
    ['.', true],
    ['Album', false],
    ['Trips', false],
    ['Trips/Beach', false],
  ]);
  const ancestors = ancestorsOf(root, [
    root,
    { id: 'Trips', name: 'Trips' },
    { id: 'Trips/Beach', name: 'Beach' },
  ]);
  const opened = withOpened(saved, [['Album', true]], ancestors);
  expect(opened).toEqual(
    new Map([
      ['.', true],
      ['Album', true],
      ['Trips', false],
    ]),
  );
});
