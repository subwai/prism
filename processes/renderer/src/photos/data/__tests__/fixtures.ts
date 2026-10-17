import { PhotoLibrary } from '#photos/data/library';
import type {
  FolderChange,
  FolderChanges,
  PhotoEntry,
  PhotosAPI,
  RenameResult,
  ScanBatch,
  ScanOptions,
  ThumbnailFrame,
  ThumbnailResult
} from '@app/shared';
import { vi } from 'vitest';

export function fakeAPI(batches: ScanBatch[]) {
  let cursor = 0;
  return {
    cancelScan: vi.fn((_id: string) => Promise.resolve()),
    cancelThumbnail: vi.fn((_id: string) => Promise.resolve()),
    closeFolder: vi.fn(() => Promise.resolve()),
    getOriginalURL: vi.fn((id: string) => Promise.resolve(`media://original/${id}`)),
    inspectFolder: vi.fn((_id: string) =>
      Promise.resolve({ covers: [], hasEntries: false, hasSubfolders: false })
    ),
    nextBatch: vi.fn((_id: string) => {
      const batch = batches[cursor];
      cursor += 1;
      return Promise.resolve(batch ?? { done: true, entries: [], errors: [] });
    }),
    onChange: vi.fn((_listener: (changes: FolderChanges) => void) => vi.fn()),
    openFolder: vi.fn(() => Promise.resolve({ id: '.', name: 'Pictures' })),
    renameEntry: vi.fn((_id: string, _name: string) =>
      Promise.resolve<RenameResult>({ error: 'Not renamed.' })
    ),
    requestThumbnail: vi.fn(() => Promise.resolve<ThumbnailResult>({ status: 'unsupported' })),
    restoreFolder: vi.fn(() => Promise.resolve(null)),
    showEntryMenu: vi.fn((_id: string) => Promise.resolve(null)),
    startScan: vi.fn((_options: ScanOptions) => Promise.resolve(crypto.randomUUID())),
    storeThumbnail: vi.fn(({ entryId }: ThumbnailFrame) =>
      Promise.resolve<ThumbnailResult>({ status: 'ready', url: `media://thumbnail/${entryId}` })
    )
  } satisfies PhotosAPI;
}
export const photo: PhotoEntry = {
  id: 'photo.jpg',
  kind: 'image',
  name: 'photo.jpg',
  parentId: '.'
};
export const child: PhotoEntry = {
  id: 'Trips & 2026',
  kind: 'directory',
  name: 'Trips & 2026',
  parentId: '.'
};

export function fixture(batches: ScanBatch[]) {
  const api = fakeAPI(batches);
  return {
    api,
    library: new PhotoLibrary({ id: '.', name: 'Pictures' }, api),
    signal: new AbortController().signal
  };
}

export function changed(entry: PhotoEntry, change: Partial<FolderChange> = {}): FolderChange {
  return {
    contentChanged: false,
    entry,
    id: entry.id,
    listingChanged: true,
    parentId: entry.parentId,
    ...change
  };
}

export function removed(entry: PhotoEntry): FolderChange {
  return changed(entry, { entry: null });
}
