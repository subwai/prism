import { openScan } from '#photos/data/directory-scan';
import { changed, child, fixture, photo, removed } from './fixtures.ts';
import type { PhotoEntry, ScanBatch, ThumbnailResult } from '@prism/shared';
import { afterEach, expect, test, vi } from 'vitest';

vi.mock(import('#photos/data/video-frame'), () => ({
  captureFrame: vi.fn(() => Promise.resolve(new Uint8Array([1, 2, 3])))
}));

afterEach(() => {
  vi.restoreAllMocks();
});

/** Makes every batch overrun the page budget, so each page holds exactly one batch. */
function slowScan() {
  let now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => {
    now += 1000;
    return now;
  });
}

test('returns a partial first page when a scan outlasts its budget, then streams the rest', async () => {
  slowScan();
  const { api, library, signal } = fixture([
    { done: false, entries: [child], errors: [] },
    { done: true, entries: [photo], errors: [] }
  ]);
  api.nextBatch.mockImplementationOnce(() =>
    Promise.resolve({ done: false, entries: [child], errors: [] })
  );
  const scan = await library.openGallery({ directoryId: '.' }, signal);
  const listener = vi.fn();
  scan.subscribe(listener);
  expect(scan.getSnapshot()).toMatchObject({ entries: [child], loading: true });
  expect(library.trail(child.id)).toEqual([library.root, child]);
  await vi.waitFor(() => expect(scan.getSnapshot().loading).toBe(false));
  expect(scan.getSnapshot().entries).toEqual([child, child, photo]);
  expect(listener).toHaveBeenCalled();
  library.dispose();
});

test('a scan that finishes within the budget arrives complete in the first page', async () => {
  const { library, signal } = fixture([
    { done: false, entries: [child], errors: [] },
    { done: true, entries: [photo], errors: [] }
  ]);
  const scan = await library.openGallery({ directoryId: '.' }, signal);
  expect(scan.getSnapshot()).toMatchObject({ entries: [child, photo], loading: false });
  library.dispose();
});

test('closes the previous gallery when navigating to another folder or view', async () => {
  slowScan();
  const { api, library, signal } = fixture([]);
  const never = Promise.withResolvers<ScanBatch>();
  api.nextBatch
    .mockResolvedValueOnce({ done: false, entries: [photo], errors: [] })
    .mockReturnValueOnce(never.promise);
  api.startScan.mockResolvedValueOnce('0-0-0-0-previous');
  const previous = await library.openGallery({ directoryId: '.' }, signal);
  await library.openGallery({ directoryId: '.', recursive: true }, signal);
  expect(api.cancelScan).toHaveBeenCalledWith('0-0-0-0-previous');
  expect(previous.getSnapshot()).toMatchObject({ entries: [photo], loading: true });
  expect(api.startScan).toHaveBeenLastCalledWith({ directoryId: '.', recursive: true });
  library.dispose();
});

test('caches directory reads and re-reads them on refresh, keeping old children meanwhile', async () => {
  const { api, library } = fixture([
    { done: true, entries: [child], errors: [] },
    { done: true, entries: [photo], errors: [] }
  ]);
  await Promise.all([library.directory('.'), library.directory('.')]);
  expect(api.startScan).toHaveBeenCalledTimes(1);
  expect(api.startScan).toHaveBeenCalledWith({ directoryId: '.' });
  await library.refresh();
  expect(api.refresh).toHaveBeenCalledOnce();
  expect(library.peekDirectory('.')?.entries).toEqual([child]);
  expect(library.trail(child.id)).toEqual([library.root, child]);
  await expect(library.directory('.')).resolves.toMatchObject({ entries: [photo] });
  expect(library.peekDirectory('.')?.entries).toEqual([photo]);
  expect(api.startScan).toHaveBeenCalledTimes(2);
});

test('reading many folders keeps the ones read before', async () => {
  const { api, library } = fixture([]);
  const folders = Array.from({ length: 70 }, (_entry, index) => ({
    ...child,
    id: `Folder ${index}`,
    name: `Folder ${index}`
  }));
  api.nextBatch.mockResolvedValueOnce({ done: true, entries: folders, errors: [] });
  await library.directory('.');
  await Promise.all(folders.map((folder) => library.directory(folder.id)));
  expect(library.peekDirectory('.')?.entries).toHaveLength(70);
});

test('surfaces scan failures while retaining the entries already read', async () => {
  slowScan();
  const { api, library, signal } = fixture([{ done: false, entries: [photo], errors: [] }]);
  api.nextBatch
    .mockResolvedValueOnce({ done: false, entries: [photo], errors: [] })
    .mockRejectedValueOnce(new Error('Disk disconnected'));
  const scan = await library.openGallery({ directoryId: '.' }, signal);
  await vi.waitFor(() => expect(scan.getSnapshot().loading).toBe(false));
  expect(scan.getSnapshot()).toMatchObject({
    entries: [photo],
    error: 'Error: Disk disconnected',
    loading: false
  });
  library.dispose();
});

test('queued thumbnails for entries scrolled out of view wait until wanted again', async () => {
  const { api, library } = fixture([]);
  const held = Promise.withResolvers<ThumbnailResult>();
  api.requestThumbnail.mockImplementation(() => held.promise);
  const ids = ['a', 'b', 'c', 'd', 'e'];
  const releases = ids.map((id) => library.want(id));
  const reads = ids.map((id) => library.thumbnail(id));
  await vi.waitFor(() => expect(api.requestThumbnail).toHaveBeenCalledTimes(4));
  releases[4]?.();
  const failed: ThumbnailResult = { message: 'No thumbnail.', status: 'failed' };
  held.resolve(failed);
  await Promise.all(reads.slice(0, 4));
  expect(api.requestThumbnail).toHaveBeenCalledTimes(4);
  library.want('e');
  await expect(reads[4]).resolves.toEqual(failed);
  expect(api.requestThumbnail).toHaveBeenCalledTimes(5);
});

test('an aborted page request keeps its batch and leaves the scan open for the retry', async () => {
  slowScan();
  const second: PhotoEntry = { id: 'b.jpg', kind: 'image', name: 'b.jpg', parentId: '.' };
  const { api, signal } = fixture([{ done: false, entries: [photo], errors: [] }]);
  const scan = await openScan(api, { directoryId: '.' }, signal);
  await scan.next(signal);
  const pending = Promise.withResolvers<ScanBatch>();
  api.nextBatch.mockImplementationOnce(() => pending.promise);
  const superseded = new AbortController();
  const first = scan.next(superseded.signal);
  await vi.waitFor(() => expect(api.nextBatch).toHaveBeenCalledTimes(2));
  superseded.abort();
  const retry = scan.next(signal);
  pending.resolve({ done: false, entries: [second], errors: [] });
  await expect(first).rejects.toThrow();
  const state = await retry;
  expect(state).toMatchObject({ error: null, loading: false });
  expect(state.entries.map((entry) => entry.id)).toEqual(['photo.jpg', 'b.jpg']);
  expect(api.cancelScan).toHaveBeenCalledTimes(1);
});

test('refresh keeps previous thumbnails readable until fresh ones arrive', async () => {
  const { api, library } = fixture([]);
  api.requestThumbnail.mockResolvedValue({ status: 'ready', url: 'media://thumbnail/a' });
  library.want(photo.id);
  await library.thumbnail(photo.id);
  await library.refresh();
  api.requestThumbnail.mockResolvedValue({ status: 'ready', url: 'media://thumbnail/b' });
  expect(library.peekThumbnail(photo.id)).toEqual({ status: 'ready', url: 'media://thumbnail/a' });
  await library.thumbnail(photo.id);
  expect(api.requestThumbnail).toHaveBeenCalledTimes(2);
  expect(library.peekThumbnail(photo.id)).toEqual({ status: 'ready', url: 'media://thumbnail/b' });
});

test('takes the still of a video the system cannot render, and stores it as its thumbnail', async () => {
  const { api, library } = fixture([]);
  api.requestThumbnail.mockResolvedValue({ status: 'frame-needed' });
  library.want('clip.webm');
  await expect(library.thumbnail('clip.webm')).resolves.toEqual({
    status: 'ready',
    url: 'media://thumbnail/clip.webm'
  });
  expect(api.getOriginalURL).toHaveBeenCalledWith('clip.webm');
  expect(api.storeThumbnail).toHaveBeenCalledWith({
    entryId: 'clip.webm',
    image: new Uint8Array([1, 2, 3])
  });
});

test('a rename patches the open view at once', async () => {
  const { api, library, signal } = fixture([{ done: true, entries: [photo], errors: [] }]);
  const scan = await library.openGallery({ directoryId: '.' }, signal);
  const renamed = { ...photo, id: 'beach.jpg', name: 'beach.jpg' };
  api.renameEntry.mockResolvedValueOnce({
    changes: [removed(photo), changed(renamed)],
    entry: renamed
  });
  await expect(library.rename(photo.id, 'beach.jpg')).resolves.toEqual({
    entry: renamed,
    lost: false
  });
  expect(api.renameEntry).toHaveBeenCalledWith(photo.id, 'beach.jpg');
  expect(scan.getSnapshot().entries).toEqual([renamed]);
  expect(library.follow(photo.id)).toBe('beach.jpg');
  library.dispose();
});

test('renaming the open folder reloads the view, which follows it', async () => {
  const { api, library, signal } = fixture([
    { done: true, entries: [child], errors: [] },
    { done: true, entries: [], errors: [] }
  ]);
  await library.openGallery({ directoryId: '.' }, signal);
  await library.openGallery({ directoryId: child.id }, signal);
  const renamed = { ...child, id: 'Holidays', name: 'Holidays' };
  api.renameEntry.mockResolvedValueOnce({
    changes: [removed(child), changed(renamed)],
    entry: renamed
  });
  await expect(library.rename(child.id, 'Holidays')).resolves.toMatchObject({ lost: true });
  expect(library.trail(child.id)).toBeNull();
  expect(library.trail(library.follow(child.id))).toEqual([library.root, renamed]);
  library.dispose();
});

test('a failed rename changes nothing', async () => {
  const { library } = fixture([]);
  await expect(library.rename(photo.id, 'taken.jpg')).resolves.toEqual({ error: 'Not renamed.' });
  expect(library.follow(photo.id)).toBe(photo.id);
});
