import { PhotoLibrary } from '#photos/data/library';
import type { PhotoEntry, PhotosAPI, ScanBatch, ScanOptions, ThumbnailResult } from '@app/shared';
import { expect, test, vi } from 'vitest';

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

test('returns a first gallery page before pulling the rest', async () => {
  const { api, library, signal } = fixture([
    { done: false, entries: [child], errors: [] },
    { done: true, entries: [photo], errors: [] }
  ]);
  const { scan, page } = await library.openGallery({ directoryId: '.' }, signal);
  expect(page.state.entries).toEqual([child]);
  expect(page.state.loading).toBe(true);
  expect(api.nextBatch).toHaveBeenCalledTimes(1);
  expect(library.trail(child.id)).toEqual([library.root, child]);
  const next = await library.next(scan.key, signal);
  expect(next.state.entries).toEqual([child, photo]);
  expect(next.state.loading).toBe(false);
  library.dispose();
});

test('closes the previous gallery when navigating to another folder or view', async () => {
  const { api, library, signal } = fixture([{ done: false, entries: [photo], errors: [] }]);
  const previous = await library.openGallery({ directoryId: '.' }, signal);
  await library.openGallery({ directoryId: '.', recursive: true }, signal);
  expect(api.cancelScan).toHaveBeenCalled();
  expect(await library.next(previous.scan.key, signal)).toMatchObject({
    state: { loading: false }
  });
  expect(api.startScan).toHaveBeenLastCalledWith({ directoryId: '.', recursive: true });
  library.dispose();
});

test('caches shallow directory reads and retains ancestry across refreshes', async () => {
  const { api, library, signal } = fixture([{ done: true, entries: [child], errors: [] }]);
  const first = await library.readDirectory('.', signal);
  expect(await library.readDirectory('.', signal)).toBe(first);
  expect(api.startScan).toHaveBeenCalledTimes(1);
  expect(api.startScan).toHaveBeenCalledWith({ directoryId: '.' });
  library.refresh();
  expect(library.trail(child.id)).toEqual([library.root, child]);
  await library.readDirectory('.', signal);
  expect(api.startScan).toHaveBeenCalledTimes(2);
  library.dispose();
});

test('surfaces scan failures while retaining the entries already read', async () => {
  const { api, library, signal } = fixture([{ done: false, entries: [photo], errors: [] }]);
  const { scan } = await library.openGallery({ directoryId: '.' }, signal);
  api.nextBatch.mockRejectedValueOnce(new Error('Disk disconnected'));
  const { state } = await library.next(scan.key, signal);
  expect(state).toMatchObject({
    entries: [photo],
    error: 'Error: Disk disconnected',
    loading: false
  });
  library.dispose();
});

test('does no thumbnail work for a request cancelled before admission', async () => {
  const { api, library } = fixture([]);
  const controller = new AbortController();
  controller.abort();
  await expect(library.thumbnail(photo.id, controller.signal)).rejects.toMatchObject({
    name: 'AbortError'
  });
  expect(api.requestThumbnail).not.toHaveBeenCalled();
  library.dispose();
});
