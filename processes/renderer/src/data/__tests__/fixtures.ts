import { byName } from '#data/entries';
import { PhotoLibrary } from '#data/library';
import type {
  FolderChange,
  FolderChanges,
  FolderListing,
  MenuPosition,
  PhotoEntry,
  PhotosAPI,
  RenameResult,
  ThumbnailFrame,
  ThumbnailResult,
  ViewFacets,
  ViewSpec,
  ViewState,
} from '@prism/shared';
import { vi } from 'vitest';

const KINDS: Record<ViewSpec['show'], PhotoEntry['kind'][]> = {
  all: ['directory', 'image', 'video'],
  images: ['image'],
  media: ['image', 'video'],
};

/** What a view of `spec` shows of `entries`: by name, folders first, as the worker sorts. */
export function shownBy(spec: ViewSpec, entries: PhotoEntry[]) {
  const search = spec.search.trim().toLocaleLowerCase();
  return byName(
    entries.filter(
      (entry) =>
        (spec.recursive
          ? spec.directoryId === '.' || entry.id.startsWith(`${spec.directoryId}/`)
          : entry.parentId === spec.directoryId) &&
        KINDS[spec.show].includes(entry.kind) &&
        entry.name.toLocaleLowerCase().includes(search),
    ),
  );
}

/**
 * The worker's API, answering folder reads with `listings` in turn, and views with what of
 * `listed` they show.
 * Views never change unless a test tells them to.
 */
export function fakeAPI(listings: FolderListing[], listed: PhotoEntry[] = []) {
  let cursor = 0;
  const views = new Map<string, PhotoEntry[]>();
  const rowsOf = (viewId: string) => views.get(viewId) ?? [];
  return {
    closeFolder: vi.fn(() => Promise.resolve()),
    closeView: vi.fn((viewId: string) => {
      views.delete(viewId);
      return Promise.resolve();
    }),
    getOriginalURL: vi.fn((id: string) => Promise.resolve(`media://original/${id}`)),
    inspectFolder: vi.fn((_id: string) =>
      Promise.resolve({ covers: [], hasEntries: false, hasSubfolders: false }),
    ),
    listFolder: vi.fn((_id: string) => {
      const listing = listings[cursor];
      cursor += 1;
      return Promise.resolve<FolderListing>(listing ?? { entries: [], error: null, errors: [] });
    }),
    onChange: vi.fn((_listener: (changes: FolderChanges) => void) => vi.fn()),
    onView: vi.fn((_listener: (state: ViewState) => void) => vi.fn()),
    openFolder: vi.fn(() =>
      Promise.resolve({ id: '.', location: 'local' as const, name: 'Pictures' }),
    ),
    openView: vi.fn((spec: ViewSpec) => {
      const viewId = crypto.randomUUID();
      const rows = shownBy(spec, listed);
      views.set(viewId, rows);
      return Promise.resolve<ViewState>({
        count: rows.length,
        error: null,
        errors: [],
        loading: false,
        unread: 0,
        version: 1,
        viewId,
      });
    }),
    refresh: vi.fn(() => Promise.resolve()),
    renameEntry: vi.fn((_id: string, _name: string) =>
      Promise.resolve<RenameResult>({ error: 'Not renamed.' }),
    ),
    requestThumbnail: vi.fn((_id: string) =>
      Promise.resolve<ThumbnailResult>({ message: 'No thumbnail.', status: 'failed' }),
    ),
    restoreFolder: vi.fn(() => Promise.resolve(null)),
    showEntryMenu: vi.fn((_id: string, _position?: MenuPosition) => Promise.resolve(null)),
    storeThumbnail: vi.fn(({ entryId }: ThumbnailFrame) =>
      Promise.resolve<ThumbnailResult>({ status: 'ready', url: `media://thumbnail/${entryId}` }),
    ),
    viewFacets: vi.fn((_viewId: string) =>
      Promise.resolve<ViewFacets>({
        fields: { camera: [], format: [], lens: [], tag: [] },
        unread: 0,
      }),
    ),
    viewIndexOf: vi.fn((viewId: string, _version: number, entryId: string) =>
      Promise.resolve<number | null>(rowsOf(viewId).findIndex((entry) => entry.id === entryId)),
    ),
    viewRows: vi.fn((viewId: string, _version: number, start: number, count: number) =>
      Promise.resolve<PhotoEntry[] | null>(rowsOf(viewId).slice(start, start + count)),
    ),
  } satisfies PhotosAPI;
}
export const photo: PhotoEntry = {
  id: 'photo.jpg',
  kind: 'image',
  name: 'photo.jpg',
  parentId: '.',
};
export const child: PhotoEntry = {
  id: 'Trips & 2026',
  kind: 'directory',
  name: 'Trips & 2026',
  parentId: '.',
};

export function fixture(listings: FolderListing[], listed: PhotoEntry[] = []) {
  const api = fakeAPI(listings, listed);
  return {
    api,
    library: new PhotoLibrary({ id: '.', location: 'local', name: 'Pictures' }, api),
    signal: new AbortController().signal,
  };
}

export function changed(entry: PhotoEntry, change: Partial<FolderChange> = {}): FolderChange {
  return {
    contentChanged: false,
    entry,
    id: entry.id,
    listingChanged: true,
    parentId: entry.parentId,
    ...change,
  };
}

export function removed(entry: PhotoEntry): FolderChange {
  return changed(entry, { entry: null });
}

/** Tells the library's views what the worker would, as `api.onView` hears it. */
export function tellView(api: ReturnType<typeof fakeAPI>, state: ViewState) {
  for (const [listener] of api.onView.mock.calls) {
    listener(state);
  }
}
