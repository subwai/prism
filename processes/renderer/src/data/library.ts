import { patchEntries } from '#data/folder-changes';
import type { GalleryView } from '#data/gallery-view';
import { KeptViews } from '#data/kept-views';
import { createMediaCache, type MediaCache } from '#data/media-cache';
import { about, createQueryClient } from '#data/queries';
import { createRenames } from '#data/renames';
import { RequestQueue } from '#data/request-queue';
import type {
  FolderChanges,
  FolderListing,
  FolderSummary,
  PhotoEntry,
  PhotoFolder,
  PhotoRoot,
  PhotosAPI,
  ThumbnailResult,
  ViewSpec,
} from '@prism/shared';
import { type QueryClient, queryOptions } from '@tanstack/react-query';

/** Folders from the library's root down to one inside it. */
export type FolderTrail = PhotoFolder[];

/**
 * A folder's session, independent of React and routing: the views the worker holds of it, and
 * the queries views read of what is inside the folder. Route loaders read the queries they
 * wait for; components read them with `useSuspenseQuery`. Changes on disk and refreshes
 * invalidate queries, whose old data shows until fresh data replaces it, and give views new
 * versions.
 */
export interface PhotoLibrary {
  readonly id: string;
  readonly queries: QueryClient;
  readonly root: PhotoRoot;
  readonly api: PhotosAPI;
  /**
   * Marks an entry as on screen. Queued thumbnail and summary work for entries that scrolled
   * away waits until they are wanted again, so the visible ones are not stuck behind it.
   */
  want: (entryId: string) => () => void;
  /**
   * The view of what `spec` asks for, opened in the worker or kept from an earlier visit, which
   * shows again as it is.
   */
  view: (spec: ViewSpec) => Promise<GalleryView>;
  /** The view the gallery shows, whose folder going away reads it again to say so. */
  openGallery: (spec: ViewSpec) => Promise<GalleryView>;
  /** A folder's complete, shallow listing. */
  directoryQuery: (directoryId: string) => ReturnType<typeof directoryOptions>;
  /** Reads a folder's listing, or reads it again if a change or refresh invalidated it. */
  directory: (directoryId: string) => Promise<FolderListing>;
  peekDirectory: (directoryId: string) => FolderListing | undefined;
  /** The folders from the root down to `id`, or `null` if it is not a known folder. */
  trail: (id: string) => FolderTrail | null;
  /**
   * Folder covers and whether a folder has subfolders; `null` if it could not be read. Read
   * once the folder is wanted on screen.
   */
  summaryQuery: (directoryId: string) => ReturnType<typeof summaryOptions>;
  summary: (directoryId: string) => Promise<FolderSummary | null>;
  peekSummary: (directoryId: string) => FolderSummary | null | undefined;
  /** Read once the entry is wanted on screen. */
  thumbnailQuery: MediaCache['thumbnailQuery'];
  thumbnail: (entryId: string) => Promise<ThumbnailResult>;
  peekThumbnail: (entryId: string) => ThumbnailResult | undefined;
  originalQuery: MediaCache['originalQuery'];
  peekOpeningFrame: MediaCache['peekOpeningFrame'];
  /**
   * Reads everything again; what is on screen stays until its fresh data arrives. Open views
   * stay open: the worker reads their folders again and gives them new versions.
   */
  refresh: () => Promise<void>;
  /**
   * Brings what the session has read up to date with changes on disk, in place: listings are
   * patched rather than read again, and only changed contents are. True if the open view must
   * be read again instead, which the router does.
   */
  applyChanges: (changes: FolderChanges) => boolean;
  /**
   * Renames an entry and patches what is on screen at once. `lost` is true if the open view
   * must be read again, as its folder or one holding it was renamed; `follow` then finds it.
   */
  rename: (entryId: string, name: string) => ReturnType<typeof renameIn>;
  /** Where an entry renamed in this window is now. Only for IDs no longer found. */
  follow: (id: string) => string;
  /** Closes every view, so the next ones read their folders again. */
  dispose: () => void;
  /** Ends the session, as another folder opens. */
  close: () => void;
}

function directoryOptions(
  api: PhotosAPI,
  listings: RequestQueue,
  found: (entries: PhotoEntry[]) => void,
  directoryId: string,
) {
  return queryOptions({
    queryFn: () =>
      listings.run(directoryId, async (): Promise<FolderListing> => {
        try {
          const listing = await api.listFolder(directoryId);
          found(listing.entries);
          return listing;
        } catch (error) {
          return { entries: [], error: String(error), errors: [] };
        }
      }),
    queryKey: ['directory', directoryId],
  });
}

function summaryOptions(api: PhotosAPI, inspections: RequestQueue, directoryId: string) {
  return queryOptions({
    queryFn: () =>
      inspections.run(directoryId, (): Promise<FolderSummary | null> =>
        api.inspectFolder(directoryId).catch(() => null),
      ),
    queryKey: ['summary', directoryId],
  });
}

/** Renames an entry in the worker, then applies its changes here. */
async function renameIn(
  library: Pick<PhotoLibrary, 'api' | 'applyChanges'>,
  record: (from: string, to: string) => void,
  entryId: string,
  name: string,
) {
  const result = await library.api.renameEntry(entryId, name);
  if ('error' in result) {
    return result;
  }
  const lost = library.applyChanges({ changed: result.changes, everything: false });
  if (result.entry.id !== entryId) {
    record(entryId, result.entry.id);
  }
  return { entry: result.entry, lost };
}

/** The folders from `root` down to `id`, through the folders known so far. */
function trailIn(root: PhotoRoot, folders: Map<string, PhotoEntry>, id: string) {
  const trail: PhotoFolder[] = [];
  // However deep, a trail passes each known folder once at most.
  for (let current = id; current !== root.id;) {
    const folder = folders.get(current);
    if (!folder || trail.length > folders.size) {
      return null;
    }
    trail.push(folder);
    current = folder.parentId;
  }
  return [root, ...trail.toReversed()];
}

export function createLibrary(root: PhotoRoot, api: PhotosAPI): PhotoLibrary {
  const queries = createQueryClient();
  const interest = new Map<string, number>();
  const wanted = (id: string) => interest.has(id);
  const listings = new RequestQueue(2);
  const inspections = new RequestQueue(4, wanted);
  const media = createMediaCache(api, queries, wanted);
  const folders = new Map<string, PhotoEntry>();
  const renames = createRenames();
  const views = new KeptViews(api, queries, {
    follow: (id) => renames.follow(id),
    found: rememberFolders,
  });
  /** The folder the gallery shows. */
  const gallery = { shown: null as string | null };

  function rememberFolders(entries: PhotoEntry[]) {
    for (const entry of entries) {
      if (entry.kind === 'directory') {
        folders.set(entry.id, entry);
      }
    }
  }

  const directoryQuery = (directoryId: string) =>
    directoryOptions(api, listings, rememberFolders, directoryId);
  const summaryQuery = (directoryId: string) => summaryOptions(api, inspections, directoryId);
  const peekDirectory = (directoryId: string) =>
    queries.getQueryData(directoryQuery(directoryId).queryKey);
  const trail = (id: string) => trailIn(root, folders, id);

  async function refresh() {
    media.clear();
    // The worker forgets what it remembers of folders first, so the reads below see them anew.
    await api.refresh().catch(() => null);
    queries.invalidateQueries().catch(() => null);
  }

  function applyChanges({ changed, everything }: FolderChanges) {
    if (everything) {
      refresh().catch(() => null);
      return true;
    }
    // The open folder, or one holding it, is gone; reading it again says so.
    const open = gallery.shown === null ? null : trail(gallery.shown);
    const lost = changed.some(
      ({ id, entry }) => entry === null && open?.some((folder) => folder.id === id),
    );
    media.forget(
      changed
        .filter((change) => change.contentChanged || change.entry === null)
        .map(({ id }) => id),
    );
    const relisted = new Set<string>();
    const removed = new Set<string>();
    for (const { id, parentId, entry, listingChanged } of changed) {
      if (listingChanged) {
        relisted.add(parentId);
      }
      if (entry?.kind === 'directory') {
        folders.set(id, entry);
      } else if (entry === null) {
        folders.delete(id);
        removed.add(id);
      }
    }
    queries.removeQueries({
      predicate: ({ queryKey }) => about(queryKey, ['directory'], removed),
    });
    // Covers can come from deep inside a folder, through folders this window never listed, so
    // every summary is read again; the worker still remembers the ones that did not change.
    if (relisted.size > 0) {
      queries.invalidateQueries({ queryKey: ['summary'] }).catch(() => null);
    }
    // Listings open in the sidebar and folder previews.
    for (const parentId of new Set(changed.map((change) => change.parentId))) {
      const listing = peekDirectory(parentId);
      const entries = listing && patchEntries(listing.entries, changed, (id) => id === parentId);
      if (listing && entries) {
        queries.setQueryData(directoryQuery(parentId).queryKey, { ...listing, entries });
      }
    }
    // Views follow the changes in the worker, which gives them new versions.
    return lost;
  }

  return {
    api,
    applyChanges,
    close() {
      views.stop();
      media.clear();
      queries.clear();
    },
    directory: (directoryId) => queries.fetchQuery(directoryQuery(directoryId)),
    directoryQuery,
    dispose: () => views.clear(),
    follow: renames.follow,
    id: crypto.randomUUID(),
    openGallery(spec) {
      gallery.shown = spec.directoryId;
      return views.view(spec);
    },
    originalQuery: media.originalQuery,
    peekDirectory,
    peekOpeningFrame: media.peekOpeningFrame,
    peekSummary: (directoryId) => queries.getQueryData(summaryQuery(directoryId).queryKey),
    peekThumbnail: (entryId) => queries.getQueryData(media.thumbnailQuery(entryId).queryKey),
    queries,
    refresh,
    rename: (entryId, name) =>
      renameIn(
        { api, applyChanges },
        (from, to) => renames.record(from, to, folders),
        entryId,
        name,
      ),
    root,
    summary: (directoryId) => queries.fetchQuery(summaryQuery(directoryId)),
    summaryQuery,
    thumbnail: (entryId) => queries.fetchQuery(media.thumbnailQuery(entryId)),
    thumbnailQuery: media.thumbnailQuery,
    trail,
    view: (spec) => views.view(spec),
    want(entryId) {
      interest.set(entryId, (interest.get(entryId) ?? 0) + 1);
      media.wake(entryId);
      inspections.wake(entryId);
      return () => {
        const count = (interest.get(entryId) ?? 1) - 1;
        if (count === 0) {
          interest.delete(entryId);
        } else {
          interest.set(entryId, count);
        }
      };
    },
  };
}
