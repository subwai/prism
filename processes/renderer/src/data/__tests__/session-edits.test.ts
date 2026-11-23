import { shownEntry } from '#data/edits/pending-edits';
import { rateEntry } from '#data/edits/ratings';
import { folderSpec } from '#data/urls';
import { changed, child, fixture, photo, removed } from './fixtures.ts';
import { treeListingOf } from './tree-listings.ts';
import type { PhotoEntry, SerializedTreeListing } from '@prism/shared';
import { QueryObserver } from '@tanstack/react-query';
import { expect, test, vi } from 'vitest';

const contents = (entries: PhotoEntry[]) => ({ entries, error: null, missing: false, read: true });

test('a rating shows at once, then as answered until the rows on screen are read again', async () => {
  const rated = { ...photo, rating: 4 as const };
  const { api, library } = fixture([contents([photo]), contents([rated])]);
  const observer = new QueryObserver(library.queries, library.directoryQuery('.'));
  const stop = observer.subscribe(() => null);
  await library.directory('.');
  const shown = () =>
    shownEntry(library.edits.getSnapshot(), library.peekDirectory('.')?.entries[0] ?? photo);
  const written = Promise.withResolvers<null>();
  api.rateEntry.mockImplementationOnce(async () => {
    await written.promise;
    return { entry: rated, kind: 'rated' };
  });
  const secondList = Promise.withResolvers<null>();
  const list = api.listFolder.getMockImplementation();
  api.listFolder.mockImplementationOnce(async (id) => {
    await secondList.promise;
    return list?.(id) ?? contents([]);
  });
  const rating = rateEntry(library, photo.id, 3);
  expect(shown()).toMatchObject({ rating: 3 });
  written.resolve(null);
  // The worker answers with what the file holds; the folder's contents still have it unrated.
  await vi.waitFor(() => expect(api.listFolder).toHaveBeenCalledTimes(2));
  expect(library.peekDirectory('.')?.entries).toEqual([photo]);
  expect(shown()).toMatchObject({ rating: 4 });
  secondList.resolve(null);
  await rating;
  expect(library.edits.getSnapshot().edits.size).toBe(0);
  expect(shown()).toEqual(rated);
  stop();
});

test('a failed rating shows the old one again', async () => {
  const { library } = fixture([]);
  const rating = rateEntry(library, photo.id, 3);
  expect(shownEntry(library.edits.getSnapshot(), photo)).toMatchObject({ rating: 3 });
  await expect(rating).resolves.toEqual({ error: 'Not rated.', kind: 'failed' });
  expect(shownEntry(library.edits.getSnapshot(), photo)).toBe(photo);
});

test('a failed rename shows the old name again', async () => {
  const { library } = fixture([]);
  const renaming = library.rename(photo.id, 'taken.jpg');
  expect(shownEntry(library.edits.getSnapshot(), photo).name).toBe('taken.jpg');
  await expect(renaming).resolves.toEqual({ error: 'Not renamed.', kind: 'failed' });
  expect(shownEntry(library.edits.getSnapshot(), photo)).toBe(photo);
  // Kept to say why until it is seen, whatever the window shows meanwhile.
  expect(library.edits.getSnapshot().failures).toEqual(
    new Map([[photo.id, { error: 'Not renamed.', name: 'taken.jpg' }]]),
  );
  library.edits.dismiss(photo.id);
  expect(library.edits.getSnapshot().failures.size).toBe(0);
});

test('a rename shows the new name at once, and on rows of the old ID once done', async () => {
  const renamed = { ...photo, id: 'shore.jpg', name: 'shore.jpg' };
  const { api, library } = fixture([]);
  const moved = Promise.withResolvers<null>();
  api.renameEntry.mockImplementationOnce(async () => {
    await moved.promise;
    return { changes: [removed(photo), changed(renamed)], entry: renamed, kind: 'renamed' };
  });
  const renaming = library.rename(photo.id, 'shore.jpg');
  expect(shownEntry(library.edits.getSnapshot(), photo)).toEqual({ ...photo, name: 'shore.jpg' });
  moved.resolve(null);
  await renaming;
  // A view read before the rename keeps the row, under its old ID, until its next version.
  expect(shownEntry(library.edits.getSnapshot(), photo)).toEqual({ ...photo, name: 'shore.jpg' });
  expect(library.edits.getSnapshot().edits.size).toBe(0);
  expect(library.edits.currentIdOf(photo.id)).toBe(renamed.id);
});

/** The catalog's tree listing of `folders`, none of them read yet, as a rename leaves them. */
function unread(folders: PhotoEntry[]): SerializedTreeListing {
  return treeListingOf(folders.map(({ id, parentId, name }) => [id, parentId, name, null]));
}

test('renaming the open folder reloads the view, which follows it', async () => {
  const { api, library } = fixture([], [child]);
  await library.tree.readOnce();
  await library.openGallery(folderSpec(child.id));
  const renamed = { ...child, id: 'Holidays', name: 'Holidays' };
  api.renameEntry.mockResolvedValueOnce({
    changes: [removed(child), changed(renamed)],
    entry: renamed,
    kind: 'renamed',
  });
  // The worker answers once the catalog lists the folder under its new name.
  api.listSubfolders.mockResolvedValueOnce(unread([renamed]));
  await expect(library.rename(child.id, 'Holidays')).resolves.toMatchObject({ lost: true });
  expect(library.trail(child.id)).toEqual([library.root, renamed]);
  library.dispose();
});

test('renaming a folder holding the open one keeps the open one where it is, under the new name', async () => {
  const bay: PhotoEntry = {
    id: `${child.id}/Bay`,
    kind: 'directory',
    name: 'Bay',
    parentId: child.id,
  };
  const { api, library } = fixture([], [child, bay]);
  await library.tree.readOnce();
  await library.openGallery(folderSpec(bay.id));
  const renamed = { ...child, id: 'Holidays', name: 'Holidays' };
  api.renameEntry.mockResolvedValueOnce({
    changes: [removed(child), changed(renamed)],
    entry: renamed,
    kind: 'renamed',
  });
  // The catalog moved what is inside it too, which the tree reads again under the new name.
  api.listSubfolders.mockResolvedValueOnce(unread([renamed]));
  api.listSubfolders.mockResolvedValueOnce(
    unread([{ ...bay, id: 'Holidays/Bay', parentId: 'Holidays' }]),
  );
  await expect(library.rename(child.id, 'Holidays')).resolves.toMatchObject({ lost: true });
  expect(api.listSubfolders.mock.lastCall?.[0].toSorted()).toEqual(['Holidays', 'Holidays/Bay']);
  expect(library.trail(bay.id)?.map(({ id, name }) => [id, name])).toEqual([
    ['.', 'Pictures'],
    ['Holidays', 'Holidays'],
    ['Holidays/Bay', 'Bay'],
  ]);
  library.dispose();
});
