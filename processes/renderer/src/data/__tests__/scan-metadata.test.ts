import { arrangeView } from '#data/entries';
import { fixture, photo, slowScan } from './fixtures.ts';
import type { PhotoEntry, PhotoMetadata } from '@prism/shared';
import { afterEach, expect, test, vi } from 'vitest';

afterEach(() => {
  vi.restoreAllMocks();
});

function metadata(modifiedMs: number): PhotoMetadata {
  return { accessedMs: 0, createdMs: 0, modifiedMs, size: 0 };
}

test('sorting by date fills in the metadata of what a scan listed, without listing it again', async () => {
  const older: PhotoEntry = { id: 'older.jpg', kind: 'image', name: 'older.jpg', parentId: '.' };
  const gone: PhotoEntry = { id: 'gone.jpg', kind: 'image', name: 'gone.jpg', parentId: '.' };
  const { api, library, signal } = fixture([
    { done: true, entries: [photo, older, gone], errors: [] },
  ]);
  api.readMetadata.mockImplementation((ids) =>
    Promise.resolve(
      ids.map((id) => ({ [photo.id]: metadata(2), [older.id]: metadata(1) })[id] ?? null),
    ),
  );
  const scan = await library.openGallery({ directoryId: '.', recursive: true }, signal);
  expect(api.readMetadata).not.toHaveBeenCalled();
  await library.openGallery({ directoryId: '.', metadata: true, recursive: true }, signal);
  expect(api.startScan).toHaveBeenCalledTimes(1);
  expect(api.readMetadata).toHaveBeenCalledWith([photo.id, older.id, gone.id]);
  const { entries, sorting } = scan.getSnapshot();
  expect(sorting).toBe(false);
  const sorted = arrangeView(entries, 'filmstrip', {
    descending: false,
    search: '',
    sort: 'modified',
  });
  expect(sorted.map((entry) => entry.id)).toEqual([gone.id, older.id, photo.id]);
  // Entries that are gone are not asked about again.
  await library.openGallery({ directoryId: '.', recursive: true }, signal);
  await library.openGallery({ directoryId: '.', metadata: true, recursive: true }, signal);
  expect(api.readMetadata).toHaveBeenCalledTimes(1);
  library.dispose();
});

test('sorting by date while a scan reads keeps the scan, and reads metadata for later pages too', async () => {
  slowScan();
  const later: PhotoEntry = { id: 'later.jpg', kind: 'image', name: 'later.jpg', parentId: '.' };
  const { api, library, signal } = fixture([
    { done: false, entries: [photo], errors: [] },
    { done: true, entries: [later], errors: [] },
  ]);
  api.readMetadata.mockImplementation((ids) => Promise.resolve(ids.map(() => metadata(1))));
  const scan = await library.openGallery({ directoryId: '.' }, signal);
  await expect(library.openGallery({ directoryId: '.', metadata: true }, signal)).resolves.toBe(
    scan,
  );
  await vi.waitFor(() =>
    expect(scan.getSnapshot()).toMatchObject({ loading: false, sorting: false }),
  );
  expect(api.startScan).toHaveBeenCalledTimes(1);
  const { entries } = scan.getSnapshot();
  expect(entries.map((entry) => entry.id)).toEqual([photo.id, later.id]);
  expect(entries.every((entry) => entry.metadata?.modifiedMs === 1)).toBe(true);
  library.dispose();
});

test("sorting by date taken reads photos' EXIF details for what a scan listed with metadata", async () => {
  const clip: PhotoEntry = { id: 'clip.mp4', kind: 'video', name: 'clip.mp4', parentId: '.' };
  const { api, library, signal } = fixture([
    { done: true, entries: [{ ...photo, metadata: metadata(5) }, clip], errors: [] },
  ]);
  api.readMetadata.mockImplementation((ids) => Promise.resolve(ids.map(() => metadata(1))));
  api.readExif.mockImplementation((ids) => Promise.resolve(ids.map(() => ({ takenMs: 9 }))));
  const scan = await library.openGallery({ directoryId: '.', metadata: true }, signal);
  await vi.waitFor(() => expect(scan.getSnapshot().sorting).toBe(false));
  expect(api.readExif).not.toHaveBeenCalled();
  await library.openGallery({ directoryId: '.', exif: true, metadata: true }, signal);
  await vi.waitFor(() => expect(scan.getSnapshot().sorting).toBe(false));
  expect(api.startScan).toHaveBeenCalledTimes(1);
  expect(api.readExif).toHaveBeenCalledExactlyOnceWith([photo.id]);
  const [taken, video] = scan.getSnapshot().entries;
  expect(taken).toMatchObject({ exif: { takenMs: 9 }, metadata: { modifiedMs: 5 } });
  expect(video?.exif).toBeUndefined();
  library.dispose();
});

test('a refresh lists the open folder again rather than reusing its closed scan', async () => {
  const { api, library, signal } = fixture([{ done: true, entries: [photo], errors: [] }]);
  const before = await library.openGallery({ directoryId: '.' }, signal);
  await library.refresh();
  const after = await library.openGallery({ directoryId: '.', metadata: true }, signal);
  expect(after).not.toBe(before);
  expect(api.startScan).toHaveBeenCalledTimes(2);
  library.dispose();
});
