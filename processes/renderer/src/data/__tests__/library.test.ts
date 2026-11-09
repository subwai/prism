import { folderSpec } from '#data/urls';
import { changed, child, fixture, photo, removed, tellView } from './fixtures.ts';
import type { PhotoEntry, ThumbnailResult } from '@prism/shared';
import { QueryObserver } from '@tanstack/react-query';
import { afterEach, expect, test, vi } from 'vitest';

vi.mock(import('#data/video-frame'), () => ({
  captureFrame: vi.fn(() => Promise.resolve(new Uint8Array([1, 2, 3]))),
}));

afterEach(() => {
  vi.restoreAllMocks();
});

const beach: PhotoEntry = { id: 'beach.jpg', kind: 'image', name: 'beach.jpg', parentId: '.' };

test('a view reads only the rows asked for, and learns the folders among them', async () => {
  const { api, library } = fixture([], [photo, child, beach]);
  const view = await library.openGallery(folderSpec('.'));
  expect(view.getSnapshot()).toMatchObject({ count: 3, loading: false });
  expect(api.viewRows).not.toHaveBeenCalled();
  await expect(view.entries(0, 2)).resolves.toEqual([child, beach]);
  expect(library.trail(child.id)).toEqual([library.root, child]);
  await expect(view.entry(2)).resolves.toEqual(photo);
  // One page holds them all, read once.
  expect(api.viewRows).toHaveBeenCalledOnce();
  library.dispose();
});

test('going back to a view shows the one kept, and the oldest is let go past a few', async () => {
  const { api, library } = fixture([], [photo]);
  const grid = await library.openGallery(folderSpec('.'));
  await expect(library.openGallery(folderSpec('.'))).resolves.toBe(grid);
  expect(api.openView).toHaveBeenCalledOnce();
  for (const search of ['b', 'be', 'bea', 'beac', 'beach', 'beach!']) {
    await library.openGallery({ ...folderSpec('.'), search });
  }
  await vi.waitFor(() => expect(api.closeView).toHaveBeenCalledWith(grid.viewId));
  await expect(library.openGallery(folderSpec('.'))).resolves.not.toBe(grid);
  library.dispose();
});

test('a view whose folder could not be read is opened again', async () => {
  const { api, library } = fixture([], [photo]);
  const failed = await library.openGallery(folderSpec('.'));
  tellView(api, { ...failed.getSnapshot(), error: 'Disk disconnected', loading: false });
  await expect(library.openGallery(folderSpec('.'))).resolves.not.toBe(failed);
  expect(api.closeView).toHaveBeenCalledWith(failed.viewId);
  library.dispose();
});

test('a new version reads again the rows on screen, which show meanwhile', async () => {
  const { api, library } = fixture([], [photo]);
  const view = await library.openGallery(folderSpec('.'));
  // As a page on screen is, asked again at each version the view renders.
  const observer = new QueryObserver(
    library.queries,
    view.pageQuery(0, view.getSnapshot().version),
  );
  const unsubscribe = observer.subscribe(() => null);
  await vi.waitFor(() => expect(view.peek(0)).toEqual(photo));
  const read = Promise.withResolvers<PhotoEntry[]>();
  api.viewRows.mockReturnValueOnce(read.promise);
  tellView(api, { ...view.getSnapshot(), count: 2, version: 2 });
  observer.setOptions(view.pageQuery(0, view.getSnapshot().version));
  expect(view.getSnapshot().count).toBe(2);
  expect(observer.getCurrentResult()).toMatchObject({
    data: { rows: [photo], version: 1 },
    isPlaceholderData: true,
  });
  read.resolve([beach, photo]);
  await vi.waitFor(() => expect(view.peek(0)).toEqual(beach));
  expect(api.viewRows).toHaveBeenLastCalledWith(view.viewId, 2, 0, 256);
  // The older read goes once nothing shows it, as the next version comes.
  tellView(api, { ...view.getSnapshot(), version: 3 });
  const reads = library.queries
    .getQueryCache()
    .findAll({ queryKey: ['view', view.viewId, 'page'] });
  expect(reads.map(({ queryKey: { 3: version } }) => version)).toEqual([2]);
  unsubscribe();
  library.dispose();
});

test('a page asked for at a version that has gone is read at the newest', async () => {
  const { api, library } = fixture([], [photo]);
  const view = await library.openGallery(folderSpec('.'));
  api.viewRows.mockImplementationOnce(() => {
    tellView(api, { ...view.getSnapshot(), version: 2 });
    return Promise.resolve(null);
  });
  await expect(view.entry(0)).resolves.toEqual(photo);
  expect(api.viewRows).toHaveBeenLastCalledWith(view.viewId, 2, 0, 256);
  library.dispose();
});

test('a new version leaves where entries were at older ones, which the worker lets go', async () => {
  const { api, library } = fixture([], [photo]);
  const view = await library.openGallery(folderSpec('.'));
  // As the viewer watches where its photo is, asked at the version it last rendered.
  const observer = new QueryObserver(
    library.queries,
    view.indexQuery(photo.id, view.getSnapshot().version),
  );
  const unsubscribe = observer.subscribe(() => null);
  await vi.waitFor(() => expect(observer.getCurrentResult().data).toBe(0));
  // The worker keeps only its latest versions, so it finds nothing at one gone before.
  api.viewIndexOf.mockResolvedValue(-1);
  tellView(api, { ...view.getSnapshot(), version: 2 });
  tellView(api, { ...view.getSnapshot(), version: 3 });
  await Promise.resolve();
  expect(api.viewIndexOf).toHaveBeenCalledOnce();
  expect(observer.getCurrentResult().data).toBe(0);
  unsubscribe();
  library.dispose();
});

test('where an entry is, asked at a version that has gone, is asked at the newest', async () => {
  const { api, library } = fixture([], [photo]);
  const view = await library.openGallery(folderSpec('.'));
  api.viewIndexOf.mockImplementationOnce(() => {
    tellView(api, { ...view.getSnapshot(), version: 2 });
    return Promise.resolve(null);
  });
  const query = view.indexQuery(photo.id, view.getSnapshot().version);
  await expect(library.queries.fetchQuery(query)).resolves.toBe(0);
  expect(api.viewIndexOf).toHaveBeenLastCalledWith(view.viewId, 2, photo.id);
  library.dispose();
});

test('finds an entry renamed in this window under its new name', async () => {
  const { api, library } = fixture([], [beach]);
  const view = await library.openGallery(folderSpec('.'));
  const renamed = { ...beach, id: 'shore.jpg', name: 'shore.jpg' };
  api.renameEntry.mockResolvedValueOnce({
    changes: [removed(beach), changed(renamed)],
    entry: renamed,
  });
  await library.rename(beach.id, 'shore.jpg');
  api.viewIndexOf.mockImplementation((_viewId, _version, id) =>
    Promise.resolve(id === 'shore.jpg' ? 0 : -1),
  );
  const query = view.indexQuery(beach.id, view.getSnapshot().version);
  await expect(library.queries.fetchQuery(query)).resolves.toBe(0);
  library.dispose();
});

test('a refresh keeps views open: the worker reads their folders again', async () => {
  const { api, library } = fixture([], [photo]);
  const view = await library.openGallery(folderSpec('.'));
  await library.refresh();
  expect(api.refresh).toHaveBeenCalledOnce();
  await expect(library.openGallery(folderSpec('.'))).resolves.toBe(view);
  expect(api.closeView).not.toHaveBeenCalled();
  library.dispose();
});

test('caches directory reads and re-reads them on refresh, keeping old children meanwhile', async () => {
  const { api, library } = fixture([
    { entries: [child], error: null, errors: [] },
    { entries: [photo], error: null, errors: [] },
  ]);
  await Promise.all([library.directory('.'), library.directory('.')]);
  expect(api.listFolder).toHaveBeenCalledTimes(1);
  expect(api.listFolder).toHaveBeenCalledWith('.');
  await library.refresh();
  expect(api.refresh).toHaveBeenCalledOnce();
  expect(library.peekDirectory('.')?.entries).toEqual([child]);
  expect(library.trail(child.id)).toEqual([library.root, child]);
  await expect(library.directory('.')).resolves.toMatchObject({ entries: [photo] });
  expect(library.peekDirectory('.')?.entries).toEqual([photo]);
  expect(api.listFolder).toHaveBeenCalledTimes(2);
});

test('reading many folders keeps the ones read before', async () => {
  const { api, library } = fixture([]);
  const folders = Array.from({ length: 70 }, (_entry, index) => ({
    ...child,
    id: `Folder ${index}`,
    name: `Folder ${index}`,
  }));
  api.listFolder.mockResolvedValueOnce({ entries: folders, error: null, errors: [] });
  await library.directory('.');
  await Promise.all(folders.map((folder) => library.directory(folder.id)));
  expect(library.peekDirectory('.')?.entries).toHaveLength(70);
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
    url: 'media://thumbnail/clip.webm',
  });
  expect(api.getOriginalURL).toHaveBeenCalledWith('clip.webm');
  expect(api.storeThumbnail).toHaveBeenCalledWith({
    entryId: 'clip.webm',
    image: new Uint8Array([1, 2, 3]),
  });
});

test('renaming the open folder reloads the view, which follows it', async () => {
  const { api, library } = fixture([{ entries: [child], error: null, errors: [] }]);
  await library.directory('.');
  await library.openGallery(folderSpec(child.id));
  const renamed = { ...child, id: 'Holidays', name: 'Holidays' };
  api.renameEntry.mockResolvedValueOnce({
    changes: [removed(child), changed(renamed)],
    entry: renamed,
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
