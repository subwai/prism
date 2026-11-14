import { EMPTY_TREE, type TreeState } from '#data/folder-skeleton';
import { createPendingEdits } from '#data/pending-edits';
import { folderIn, trailIn } from '#data/trails';
import type { PhotoEntry, PhotoRoot } from '@prism/shared';
import { expect, test } from 'vitest';

const root: PhotoRoot = { id: '.', location: 'local', name: 'Pictures', session: 'test' };

function folder(id: string, parentId: string, read = true): PhotoEntry {
  const name = id.split('/').at(-1) ?? id;
  return {
    id,
    kind: 'directory',
    name,
    parentId,
    summary: { covers: [], hasEntries: true, hasSubfolders: true, read },
  };
}

/** A tree of `folders`, each under its parent, as the catalog's skeleton gives it. */
function treeOf(folders: PhotoEntry[]): TreeState {
  return { ...EMPTY_TREE, children: Map.groupBy(folders, (entry) => entry.parentId) };
}

const trips = folder('Trips', '.');
const rome = folder('Trips/Rome', 'Trips');
const day = folder('Trips/Rome/Day 1', 'Trips/Rome');

/** The edits after renaming Trips to Holidays, which the tree knew as `known`. */
function renamedTrips(known: PhotoEntry[]) {
  const edits = createPendingEdits();
  edits
    .run(trips.id, 'name', 'Holidays', (edit) => {
      edits.renamed(trips.id, edit, { ...trips, id: 'Holidays', name: 'Holidays' }, known);
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

test('folders inside one renamed here keep their trail until the catalog reads them again', () => {
  const edits = renamedTrips([trips, rome, day]);
  // The catalog lists the renamed folder at once, and what it holds once it has read it again.
  const listed = { edits, tree: treeOf([folder('Holidays', '.', false)]) };
  // Asked by its old ID, as a view open before the rename asks, it is found under the new one.
  expect(trailIn(root, listed, day.id)?.map(({ id }) => id)).toEqual([
    '.',
    'Holidays',
    'Holidays/Rome',
    'Holidays/Rome/Day 1',
  ]);
  expect(folderIn(listed, 'Holidays/Rome')).toMatchObject({ name: 'Rome', parentId: 'Holidays' });
  // The catalog has read Holidays again, which lists Rome, which it has yet to read.
  const holidays = folder('Holidays', '.');
  const romeListed = folder('Holidays/Rome', 'Holidays', false);
  const reading = { edits, tree: treeOf([holidays, romeListed]) };
  expect(trailIn(root, reading, 'Holidays/Rome')).toEqual([root, holidays, romeListed]);
  expect(folderIn(reading, 'Holidays/Rome/Day 1')).toMatchObject({ parentId: 'Holidays/Rome' });
  // Once it has read Rome too, it says what is there, so a folder gone meanwhile has no trail.
  const read = { edits, tree: treeOf([holidays, folder('Holidays/Rome', 'Holidays')]) };
  expect(trailIn(root, read, 'Holidays/Rome/Day 1')).toBeNull();
});
