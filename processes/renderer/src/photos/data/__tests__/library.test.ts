import { openScan } from '#photos/data/directory-scan';
import { PhotoLibrary } from '#photos/data/library';
import type { PhotoEntry, PhotosAPI, ScanBatch, ScanOptions, ThumbnailResult } from '@app/shared';
import { afterEach, expect, test, vi } from 'vitest';

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

function fakeAPI(batches: ScanBatch[]) {
  let cursor = 0;
  return {
    cancelScan: vi.fn((_id: string) => Promise.resolve()),
    cancelThumbnail: vi.fn((_id: string) => Promise.resolve()),
    closeFolder: vi.fn(() => Promise.resolve()),
    getOriginalURL: vi.fn((id: string) => Promise.resolve(`media://original/${id}`)),
    inspectFolder: vi.fn((_id: string) =>
      Promise.resolve({ cover: null, hasEntries: false, hasSubfolders: false })
    ),
    nextBatch: vi.fn((_id: string) => {
      const batch = batches[cursor];
      cursor += 1;
      return Promise.resolve(batch ?? { done: true, entries: [], errors: [] });
    }),
    openFolder: vi.fn(() => Promise.resolve({ id: '.', name: 'Pictures' })),
    requestThumbnail: vi.fn(() => Promise.resolve<ThumbnailResult>({ status: 'unsupported' })),
    restoreFolder: vi.fn(() => Promise.resolve(null)),
    startScan: vi.fn((_options: ScanOptions) => Promise.resolve(crypto.randomUUID()))
  } satisfies PhotosAPI;
}
const photo: PhotoEntry = { id: 'photo.jpg', kind: 'image', name: 'photo.jpg', parentId: '.' };
const child: PhotoEntry = {
  id: 'Trips & 2026',
  kind: 'directory',
  name: 'Trips & 2026',
  parentId: '.'
};

function fixture(batches: ScanBatch[]) {
  const api = fakeAPI(batches);
  return {
    api,
    library: new PhotoLibrary({ id: '.', name: 'Pictures' }, api),
    signal: new AbortController().signal
  };
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
  const first = library.directory('.');
  expect(library.directory('.')).toBe(first);
  await first;
  expect(api.startScan).toHaveBeenCalledTimes(1);
  expect(api.startScan).toHaveBeenCalledWith({ directoryId: '.' });
  const listener = vi.fn();
  library.subscribe(listener);
  library.refresh();
  expect(library.peekDirectory('.')).toMatchObject({ fresh: false, value: { entries: [child] } });
  expect(library.trail(child.id)).toEqual([library.root, child]);
  await vi.waitFor(() => expect(library.peekDirectory('.')?.fresh).toBe(true));
  expect(library.peekDirectory('.')?.value.entries).toEqual([photo]);
  expect(api.startScan).toHaveBeenCalledTimes(2);
  expect(listener).toHaveBeenCalled();
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

test('queued thumbnails for entries scrolled out of view wait until read again', async () => {
  const { api, library } = fixture([]);
  const held = Promise.withResolvers<ThumbnailResult>();
  api.requestThumbnail.mockImplementation(() => held.promise);
  const ids = ['a', 'b', 'c', 'd', 'e'];
  const releases = ids.map((id) => library.want(id));
  const reads = ids.map((id) => library.thumbnail(id));
  expect(api.requestThumbnail).toHaveBeenCalledTimes(4);
  releases[4]?.();
  held.resolve({ status: 'unsupported' });
  await Promise.all(reads.slice(0, 4));
  expect(api.requestThumbnail).toHaveBeenCalledTimes(4);
  library.want('e');
  expect(library.thumbnail('e')).toBe(reads[4]);
  await expect(reads[4]).resolves.toEqual({ status: 'unsupported' });
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
  expect(library.peekThumbnail(photo.id)).toMatchObject({ fresh: true });
  library.refresh();
  expect(library.peekThumbnail(photo.id)).toEqual({
    fresh: false,
    value: { status: 'ready', url: 'media://thumbnail/a' }
  });
  await library.thumbnail(photo.id);
  expect(api.requestThumbnail).toHaveBeenCalledTimes(2);
  expect(library.peekThumbnail(photo.id)).toMatchObject({ fresh: true });
});
