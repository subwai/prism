import { byName } from '#data/entries';
import { LibrarySession } from '#data/library';
import type {
  FolderChange,
  FolderListing,
  LibraryUpdate,
  MenuPosition,
  PhotoEntry,
  PhotosAPI,
  RateResult,
  Rating,
  ReadError,
  RenameResult,
  ThumbnailFrame,
  ThumbnailResult,
  ViewFacets,
  ViewShow,
  ViewSpec,
  ViewState,
} from '@prism/shared';
import { vi } from 'vitest';

const KINDS: Record<ViewShow, PhotoEntry['kind'][]> = {
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
    onStale: vi.fn((_listener: (entryIds: string[]) => void) => vi.fn()),
    onUpdate: vi.fn((_listener: (update: LibraryUpdate) => void) => vi.fn()),
    openFolder: vi.fn(() =>
      Promise.resolve({ id: '.', location: 'local' as const, name: 'Pictures', session: 'test' }),
    ),
    openView: vi.fn((spec: ViewSpec) => {
      const viewId = crypto.randomUUID();
      const rows = shownBy(spec, listed);
      views.set(viewId, rows);
      return Promise.resolve<ViewState>({
        count: rows.length,
        error: null,
        errorCount: 0,
        loading: false,
        unread: 0,
        version: 1,
        viewId,
      });
    }),
    rateEntry: vi.fn((_id: string, _rating: Rating | null) =>
      Promise.resolve<RateResult>({ error: 'Not rated.' }),
    ),
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
    viewErrors: vi.fn((_viewId: string) => Promise.resolve<ReadError[]>([])),
    viewFacets: vi.fn((_viewId: string) =>
      Promise.resolve<ViewFacets>({
        fields: { camera: [], format: [], lens: [], rating: [], tag: [] },
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
    library: new LibrarySession(
      { id: '.', location: 'local', name: 'Pictures', session: 'test' },
      api,
    ),
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

/** Tells the library of a view's new state, as the worker would. */
export function tellView(api: ReturnType<typeof fakeAPI>, state: ViewState) {
  tell(api, { changes: null, views: [state] });
}

/** Tells the library which entries' contents are out of date, as `api.onStale` hears it. */
export function tellStale(api: ReturnType<typeof fakeAPI>, entryIds: string[]) {
  for (const [listener] of api.onStale.mock.calls) {
    listener(entryIds);
  }
}

/** Tells the library what the worker would, as `api.onUpdate` hears it. */
export function tell(api: ReturnType<typeof fakeAPI>, update: LibraryUpdate) {
  for (const [listener] of api.onUpdate.mock.calls) {
    listener(update);
  }
}
