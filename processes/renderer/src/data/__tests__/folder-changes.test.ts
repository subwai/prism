import { changed, child, fixture, photo, removed } from './fixtures.ts';
import type { PhotoEntry } from '@prism/shared';
import { expect, test } from 'vitest';

test('a rewritten file shows its old thumbnail until the new one arrives, and gets a new original URL', async () => {
  const { api, library } = fixture([]);
  api.requestThumbnail.mockResolvedValue({ status: 'ready', url: 'media://thumbnail/a' });
  library.want(photo.id);
  await library.thumbnail(photo.id);
  const video = { ...photo, kind: 'video' as const };
  const before = await library.queries.fetchQuery(library.originalQuery(video));
  library.applyChanges({
    changed: [changed(photo, { contentChanged: true, listingChanged: false })],
    everything: false
  });
  expect(library.peekThumbnail(photo.id)).toEqual({ status: 'ready', url: 'media://thumbnail/a' });
  api.requestThumbnail.mockResolvedValue({ status: 'ready', url: 'media://thumbnail/b' });
  await expect(library.thumbnail(photo.id)).resolves.toEqual({
    status: 'ready',
    url: 'media://thumbnail/b'
  });
  const after = await library.queries.fetchQuery(library.originalQuery(video));
  expect(after).not.toBe(before);
  expect(after).toBe('media://original/photo.jpg?v=1');
});

test('changes patch the gallery and open folders in place, without reading them again', async () => {
  const trips: PhotoEntry = { ...child, id: 'Trips', name: 'Trips' };
  const nested: PhotoEntry = { id: 'Trips/a.jpg', kind: 'image', name: 'a.jpg', parentId: 'Trips' };
  const added: PhotoEntry = { id: 'new.jpg', kind: 'image', name: 'new.jpg', parentId: '.' };
  const { api, library, signal } = fixture([
    { done: true, entries: [trips, photo], errors: [] },
    { done: true, entries: [trips, photo], errors: [] }
  ]);
  const scan = await library.openGallery({ directoryId: '.' }, signal);
  await library.directory('.');
  expect(
    library.applyChanges({
      changed: [changed(added), changed(nested), removed(photo)],
      everything: false
    })
  ).toBe(false);
  const ids = ['Trips', 'new.jpg'];
  expect(scan.getSnapshot().entries.map((entry) => entry.id)).toEqual(ids);
  expect(library.peekDirectory('.')?.entries.map((entry) => entry.id)).toEqual(ids);
  expect(api.startScan).toHaveBeenCalledTimes(2);
});

test('a recursive gallery drops what was inside a removed folder', async () => {
  const trips: PhotoEntry = { ...child, id: 'Trips', name: 'Trips' };
  const nested: PhotoEntry = { id: 'Trips/a.jpg', kind: 'image', name: 'a.jpg', parentId: 'Trips' };
  const { library, signal } = fixture([
    { done: true, entries: [trips, nested, photo], errors: [] }
  ]);
  const scan = await library.openGallery({ directoryId: '.', recursive: true }, signal);
  library.applyChanges({ changed: [removed(trips)], everything: false });
  expect(scan.getSnapshot().entries.map((entry) => entry.id)).toEqual(['photo.jpg']);
});

test('only losing the open folder, or too many changes to list, reads the view again', async () => {
  const trips: PhotoEntry = { ...child, id: 'Trips', name: 'Trips' };
  const { library, signal } = fixture([
    { done: true, entries: [trips], errors: [] },
    { done: true, entries: [], errors: [] }
  ]);
  await library.openGallery({ directoryId: '.' }, signal);
  await library.openGallery({ directoryId: 'Trips' }, signal);
  expect(library.applyChanges({ changed: [removed(trips)], everything: false })).toBe(true);
  expect(library.applyChanges({ changed: [], everything: true })).toBe(true);
});
