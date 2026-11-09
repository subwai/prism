import { folderSpec } from '#data/urls';
import { changed, child, fixture, photo, removed, tell, tellStale } from './fixtures.ts';
import type { PhotoEntry } from '@prism/shared';
import { expect, test, vi } from 'vitest';

test('a rewritten file shows its old thumbnail until the new one arrives, and gets a new original URL', async () => {
  const { api, library } = fixture([]);
  api.requestThumbnail.mockResolvedValue({ status: 'ready', url: 'media://thumbnail/a' });
  library.want(photo.id);
  await library.thumbnail(photo.id);
  const video = { ...photo, kind: 'video' as const };
  const before = await library.queries.fetchQuery(library.originalQuery(video));
  // The worker tells of stale contents as soon as it notices, ahead of the update.
  tellStale(api, [photo.id]);
  expect(library.peekThumbnail(photo.id)).toEqual({ status: 'ready', url: 'media://thumbnail/a' });
  api.requestThumbnail.mockResolvedValue({ status: 'ready', url: 'media://thumbnail/b' });
  await expect(library.thumbnail(photo.id)).resolves.toEqual({
    status: 'ready',
    url: 'media://thumbnail/b',
  });
  const after = await library.queries.fetchQuery(library.originalQuery(video));
  expect(after).not.toBe(before);
  expect(after).toBe('media://original/photo.jpg?v=1');
});

test('changes patch open folders in place, without reading them again', async () => {
  const trips: PhotoEntry = { ...child, id: 'Trips', name: 'Trips' };
  const nested: PhotoEntry = { id: 'Trips/a.jpg', kind: 'image', name: 'a.jpg', parentId: 'Trips' };
  const added: PhotoEntry = { id: 'new.jpg', kind: 'image', name: 'new.jpg', parentId: '.' };
  const { api, library } = fixture([{ entries: [trips, photo], error: null, errors: [] }]);
  await library.directory('.');
  expect(
    library.applyChanges({
      changed: [changed(added), changed(nested), removed(photo)],
      everything: false,
    }),
  ).toBe(false);
  expect(library.peekDirectory('.')?.entries.map((entry) => entry.id)).toEqual([
    'Trips',
    'new.jpg',
  ]);
  expect(api.listFolder).toHaveBeenCalledOnce();
});

test('only losing the open folder, or too many changes to list, reads the view again', async () => {
  const trips: PhotoEntry = { ...child, id: 'Trips', name: 'Trips' };
  const { library } = fixture([{ entries: [trips], error: null, errors: [] }]);
  await library.directory('.');
  await library.openGallery(folderSpec('Trips'));
  expect(library.applyChanges({ changed: [removed(photo)], everything: false })).toBe(false);
  expect(library.applyChanges({ changed: [removed(trips)], everything: false })).toBe(true);
  expect(library.applyChanges({ changed: [], everything: true })).toBe(true);
});

test('an update patches what changed before its views take the versions that hold it', async () => {
  const added: PhotoEntry = { id: 'new.jpg', kind: 'image', name: 'new.jpg', parentId: '.' };
  const { api, library } = fixture([{ entries: [photo], error: null, errors: [] }], [photo]);
  await library.directory('.');
  const view = await library.openGallery(folderSpec('.'));
  const seen: string[][] = [];
  view.subscribe(() => {
    seen.push(library.peekDirectory('.')?.entries.map(({ id }) => id) ?? []);
  });
  tell(api, {
    changes: { changed: [changed(added)], everything: false },
    views: [{ ...view.getSnapshot(), count: 2, version: 2 }],
  });
  expect(seen).toEqual([expect.arrayContaining([added.id, photo.id])]);
  library.dispose();
});

test('an update that loses the open folder says so, for the router to read it again', () => {
  const trips: PhotoEntry = { ...child, id: 'Trips', name: 'Trips' };
  const { api, library } = fixture([]);
  library.openGallery(folderSpec(trips.id)).catch(() => null);
  const lost = vi.fn();
  library.onLost(lost);
  tell(api, { changes: { changed: [removed(photo)], everything: false }, views: [] });
  expect(lost).not.toHaveBeenCalled();
  tell(api, { changes: { changed: [], everything: true }, views: [] });
  expect(lost).toHaveBeenCalledOnce();
});
