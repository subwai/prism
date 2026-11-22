import { createPendingEdits } from '#data/edits/pending-edits';
import { folderIn, trailIn } from '#data/tree/trails';
import { EMPTY_TREE, type TreeState } from '#data/tree/tree-state';
import type { PhotoEntry, PhotoRoot } from '@prism/shared';
import { expect, test } from 'vitest';

const root: PhotoRoot = { id: '.', location: 'local', name: 'Pictures', session: 'test' };

function folder(id: string, parentId: string, read = true, hasSubfolders = true): PhotoEntry {
  const name = id.split('/').at(-1) ?? id;
  return {
    id,
    kind: 'directory',
    name,
    parentId,
    summary: { covers: [], hasEntries: true, hasSubfolders, read },
  };
}

/** A tree of `folders`, each under its parent, as the catalog's skeleton gives it. */
function treeOf(folders: PhotoEntry[]): TreeState {
  return { ...EMPTY_TREE, children: Map.groupBy(folders, (entry) => entry.parentId) };
}

const trips = folder('Trips', '.');
const rome = folder('Trips/Rome', 'Trips');
const day = folder('Trips/Rome/Day 1', 'Trips/Rome');

/** The edits after renaming Trips to Holidays. */
function renamedTrips() {
  const edits = createPendingEdits();
  edits
    .run(trips.id, 'name', 'Holidays', (edit) => {
      edits.renamed(trips.id, edit, { ...trips, id: 'Holidays', name: 'Holidays' });
      return Promise.resolve();
    })
    .catch(() => null);
  return edits.getSnapshot();
}

test("a trail goes from the root through the catalog's folders, or is null", () => {
  const known = { edits: createPendingEdits().getSnapshot(), tree: treeOf([trips, rome]) };
  expect(trailIn(root, known, rome.id)).toEqual([root, trips, rome]);
  expect(trailIn(root, known, root.id)).toEqual([root]);
  expect(trailIn(root, known, 'Trips/Gone')).toBeNull();
});

test('a folder inside one renamed here is found under its new name, by its old ID', () => {
  // The catalog moves what is inside a renamed folder with it, which the tree reads again.
  const holidays = folder('Holidays', '.');
  const tree = treeOf([
    holidays,
    folder('Holidays/Rome', 'Holidays'),
    folder('Holidays/Rome/Day 1', 'Holidays/Rome'),
  ]);
  const known = { edits: renamedTrips(), tree };
  expect(trailIn(root, known, day.id)?.map(({ id }) => id)).toEqual([
    '.',
    'Holidays',
    'Holidays/Rome',
    'Holidays/Rome/Day 1',
  ]);
  expect(folderIn(known, 'Holidays/Rome')).toMatchObject({ name: 'Rome', parentId: 'Holidays' });
  expect(folderIn(known, rome.id)).toBeUndefined();
});
