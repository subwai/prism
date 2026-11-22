import { byName } from '#data/entries';
import { LibrarySession } from '#data/library';
import { listingOfFolders, treeListingOf } from './tree-listings.ts';
import {
  type Activity,
  type FolderChange,
  type FolderListing,
  type LibraryUpdate,
  type OpenedFolders,
  type PhotoEntry,
  type PhotosAPI,
  type PrismTrash,
  type RateResult,
  type Rating,
  type ReadError,
  type RenameResult,
  type ThumbnailResult,
  type ThumbnailUpdate,
  type TrashAPI,
  type TrashChoices,
  type TrashCounts,
  type TrashDestination,
  type TrashFileList,
  type TrashLocation,
  type TrashPlan,
  type TrashProgress,
  type TrashRunResult,
  type TrashUndoResult,
  treeListingToText,
  type ViewEntryKinds,
  type ViewFacets,
  type ViewSpec,
  type ViewState,
} from '@prism/shared';
import { vi } from 'vitest';

const KINDS: Record<ViewEntryKinds, PhotoEntry['kind'][]> = {
  all: ['directory', 'image', 'video'],
  images: ['image'],
  media: ['image', 'video'],
};

/** What a view of `spec` shows of `entries`: by name, folders first, as the worker sorts. */
function shownBy(spec: ViewSpec, entries: PhotoEntry[]) {
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
  // The catalog has read every folder of `listed`, as views show them, and sorts them by name.
  const folders = byName(listed.filter((entry) => entry.kind === 'directory'));
  const tree = treeListingOf(
    folders.map((folder) => [folder.id, folder.parentId, folder.name, null]),
  );
  return {
    closeFolder: vi.fn(() => Promise.resolve()),
    closeView: vi.fn((viewId: string) => {
      views.delete(viewId);
      return Promise.resolve();
    }),
    currentFolder: vi.fn(() => Promise.resolve<string | null>(null)),
    getOriginalURL: vi.fn<PhotosAPI['getOriginalURL']>((id) =>
      Promise.resolve(`media://original/${id}`),
    ),
    listFolder: vi.fn<PhotosAPI['listFolder']>(() => {
      const listing = listings[cursor];
      cursor += 1;
      return Promise.resolve<FolderListing>(
        listing ?? { entries: [], error: null, missing: false, read: true },
      );
    }),
    listFoldersById: vi.fn<PhotosAPI['listFoldersById']>((ids) =>
      Promise.resolve(listingOfFolders(tree, ids)),
    ),
    listSubfolders: vi.fn<PhotosAPI['listSubfolders']>(() => Promise.resolve(tree)),
    listWholeTree: vi.fn<PhotosAPI['listWholeTree']>(() =>
      Promise.resolve(treeListingToText(tree)),
    ),
    onActivity: vi.fn((_listener: (activity: Activity) => void) => vi.fn()),
    onStale: vi.fn((_listener: (entryIds: string[]) => void) => vi.fn()),
    onThumbnail: vi.fn((_listener: (news: ThumbnailUpdate) => void) => vi.fn()),
    onUpdate: vi.fn((_listener: (update: LibraryUpdate) => void) => vi.fn()),
    onUpgrading: vi.fn((_listener: (upgrading: boolean) => void) => vi.fn()),
    openFolder: vi.fn<PhotosAPI['openFolder']>(() =>
      Promise.resolve({ id: '.', location: 'local', name: 'Pictures', session: 'test' }),
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
        unsupported: 0,
        version: 1,
        viewId,
      });
    }),
    openedFolders: vi.fn(() => Promise.resolve<OpenedFolders>([])),
    rateEntry: vi.fn((_id: string, _rating: Rating | null) =>
      Promise.resolve<RateResult>({ error: 'Not rated.' }),
    ),
    refresh: vi.fn(() => Promise.resolve()),
    rememberCurrentFolder: vi.fn((_session: string, _folderId: string) => Promise.resolve()),
    rememberOpenedFolders: vi.fn((_session: string, _folders: OpenedFolders) => Promise.resolve()),
    renameEntry: vi.fn((_id: string, _name: string) =>
      Promise.resolve<RenameResult>({ error: 'Not renamed.' }),
    ),
    reportScreenContents: vi.fn<PhotosAPI['reportScreenContents']>(() => Promise.resolve()),
    restoreFolder: vi.fn(() => Promise.resolve(null)),
    showEntryMenu: vi.fn<PhotosAPI['showEntryMenu']>(() => Promise.resolve(null)),
    storeThumbnail: vi.fn<PhotosAPI['storeThumbnail']>(({ entryId }) =>
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

/** The worker's Trash API: plans that move nothing, and runs that never start. */
export function fakeTrashAPI() {
  return {
    deleteTrashBatch: vi.fn((_batchId: string) => Promise.resolve<{ error?: string }>({})),
    emptyPrismTrash: vi.fn(() => Promise.resolve<{ error?: string }>({})),
    getTrashLocation: vi.fn(() =>
      Promise.resolve<TrashLocation>({ destination: 'prism', share: 'Share' }),
    ),
    onTrashProgress: vi.fn((_listener: (progress: TrashProgress) => void) => vi.fn()),
    prismTrash: vi.fn(() => Promise.resolve<PrismTrash | null>(null)),
    prismTrashContents: vi.fn((_batchId: string) =>
      Promise.resolve<TrashCounts>({ files: 0, folders: 0, photos: 0, size: 0, videos: 0 }),
    ),
    putBackTrashBatch: vi.fn((_batchId: string) =>
      Promise.resolve<TrashUndoResult>({ error: 'Not put back.' }),
    ),
    trashView: vi.fn(
      (_viewId: string, _version: number, _choices: TrashChoices, _destination: TrashDestination) =>
        Promise.resolve<TrashRunResult>({ error: 'Not trashed.' }),
    ),
    undoTrash: vi.fn((_runId: string) =>
      Promise.resolve<TrashUndoResult>({ error: 'Not undone.' }),
    ),
    viewTrashFiles: vi.fn((_viewId: string, _version: number, _choices: TrashChoices) =>
      Promise.resolve<TrashFileList | null>({ moved: [], trashed: [] }),
    ),
    viewTrashPlan: vi.fn((_viewId: string, _version: number, _choices: TrashChoices) =>
      Promise.resolve<TrashPlan | null>({
        groups: [],
        moves: [],
        rescued: { files: 0, folders: 0, photos: 0, size: 0, videos: 0 },
        targets: [],
        totals: { files: 0, folders: 0, photos: 0, size: 0, videos: 0 },
      }),
    ),
  } satisfies TrashAPI;
}

export function fixture(listings: FolderListing[], listed: PhotoEntry[] = []) {
  const api = fakeAPI(listings, listed);
  return {
    api,
    library: new LibrarySession(
      { id: '.', location: 'local', name: 'Pictures', session: 'test' },
      api,
      fakeTrashAPI(),
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

/** Sends the library a view's new state, as the worker would. */
export function sendViewState(api: ReturnType<typeof fakeAPI>, state: ViewState) {
  sendUpdate(api, { changes: null, views: [state] });
}

/** Sends the library the entries whose files are out of date, through `api.onStale`. */
export function sendStaleEntries(api: ReturnType<typeof fakeAPI>, entryIds: string[]) {
  for (const [listener] of api.onStale.mock.calls) {
    listener(entryIds);
  }
}

/** Sends the library a thumbnail update for an entry on screen, through `api.onThumbnail`. */
export function sendThumbnail(api: ReturnType<typeof fakeAPI>, update: ThumbnailUpdate) {
  for (const [listener] of api.onThumbnail.mock.calls) {
    listener(update);
  }
}

/** Sends the library an update, as the worker would, through `api.onUpdate`. */
export function sendUpdate(api: ReturnType<typeof fakeAPI>, update: LibraryUpdate) {
  for (const [listener] of api.onUpdate.mock.calls) {
    listener(update);
  }
}

/** Sends the window what the folder's worker is busy with, through `api.onActivity`. */
export function sendActivity(api: ReturnType<typeof fakeAPI>, activity: Activity) {
  for (const [listener] of api.onActivity.mock.calls) {
    listener(activity);
  }
}
