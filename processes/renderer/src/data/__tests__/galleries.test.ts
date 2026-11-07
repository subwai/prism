import { child, fixture, photo, removed } from './fixtures.ts';
import type { PhotoEntry } from '@prism/shared';
import { expect, test } from 'vitest';

const inner: PhotoEntry = {
  id: `${child.id}/beach.jpg`,
  kind: 'image',
  name: 'beach.jpg',
  parentId: child.id,
};

test('a folder inside a kept recursive view shows from it, without listing it again', async () => {
  const { api, library, signal } = fixture([
    { done: true, entries: [child, photo, inner], errors: [] },
  ]);
  await library.openGallery({ directoryId: '.', recursive: true }, signal);
  const folder = await library.openGallery({ directoryId: child.id, recursive: true }, signal);
  expect(folder.getSnapshot()).toMatchObject({ entries: [inner], loading: false });
  const shallow = await library.openGallery({ directoryId: '.' }, signal);
  expect(shallow.getSnapshot().entries).toEqual([child, photo]);
  expect(api.startScan).toHaveBeenCalledOnce();
  library.dispose();
});

test('a recursive view starts from kept scans of folders inside it, which the worker leaves out', async () => {
  const { api, library, signal } = fixture([
    { done: true, entries: [inner], errors: [] },
    { done: true, entries: [child, photo], errors: [] },
  ]);
  await library.openGallery({ directoryId: child.id, recursive: true }, signal);
  const all = await library.openGallery({ directoryId: '.', recursive: true }, signal);
  expect(api.startScan).toHaveBeenLastCalledWith({
    directoryId: '.',
    excludeDirectoryIds: [child.id],
    recursive: true,
  });
  expect(all.getSnapshot()).toMatchObject({ entries: [inner, child, photo], loading: false });
  // The folder is listed after its contents, which still go with it.
  library.applyChanges({ changed: [removed(child)], everything: false });
  expect(all.getSnapshot().entries).toEqual([photo]);
  library.dispose();
});

test('a kept view with entries it could not read is not started from', async () => {
  const { api, library, signal } = fixture([
    {
      done: true,
      entries: [child, inner],
      errors: [{ entryId: 'locked', message: 'Permission denied', path: 'locked' }],
    },
    { done: true, entries: [inner], errors: [] },
  ]);
  await library.openGallery({ directoryId: '.', recursive: true }, signal);
  await library.openGallery({ directoryId: child.id, recursive: true }, signal);
  expect(api.startScan).toHaveBeenCalledTimes(2);
  library.dispose();
});
