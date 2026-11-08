import {
  MAX_VIEW_ROWS,
  type PhotoEntry,
  type PhotosAPI,
  type ViewSpec,
  type ViewState,
} from '@prism/shared';
import { type QueryClient, queryOptions } from '@tanstack/react-query';

/** Rows read at a time: a few screens of the grid, and one call to the worker. */
export const VIEW_PAGE = 256;

/** A page of a view's rows, and the version they were read at. */
export interface ViewPage {
  version: number;
  rows: PhotoEntry[];
}

/** The pages holding the rows from `start` up to `end`. */
export function pagesOf(start: number, end: number): number[] {
  const from = Math.max(0, start);
  if (end <= from) {
    return [];
  }
  const first = Math.floor(from / VIEW_PAGE);
  const last = Math.floor((end - 1) / VIEW_PAGE);
  return Array.from({ length: last - first + 1 }, (_page, at) => first + at);
}

/** What a view needs of the library it belongs to. */
export interface ViewOwner {
  /** Where an entry renamed in this window is now. */
  follow: (id: string) => string;
  /** Told of the entries each page read holds, so folders among them can be opened. */
  found: (entries: PhotoEntry[]) => void;
}

/**
 * A view the worker holds of the library: a folder's entries, or everything inside it, in
 * order and narrowed as its spec says. The window holds only the pages of it that it shows,
 * as queries of the library's client, so a view of a million photos costs what a screenful
 * does. The worker makes a new version as the folder is read or changes, and pages read at an
 * older one show until they are read again.
 */
export interface GalleryView {
  readonly viewId: string;
  readonly spec: ViewSpec;
  /** `useSyncExternalStore` source of the view's state. */
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => ViewState;
  /** Takes the worker's news of the view. A new version reads again what is on screen. */
  update: (state: ViewState) => void;
  pageQuery: (page: number) => ReturnType<typeof pageOptions>;
  /** The entry at `index`, if its page has been read. */
  peek: (index: number) => PhotoEntry | undefined;
  /** Reads the entry at `index`. */
  entry: (index: number) => Promise<PhotoEntry | undefined>;
  /** Reads the entries from `start` up to `end`, as a view opens with them. */
  entries: (start: number, end: number) => Promise<PhotoEntry[]>;
  /** Where `entryId` is as of the latest version, found under its new name if renamed. */
  indexQuery: (entryId: string | null) => ReturnType<typeof indexOptions>;
  /** Notes where an entry chosen on screen is, so nothing waits to ask the worker. */
  know: (entryId: string, index: number) => void;
  /** What the view's photos have of each field to filter by. */
  facetsQuery: () => ReturnType<typeof facetsOptions>;
  /** Lets go of the view, in the worker and here. */
  close: () => void;
}

function pageOptions(viewId: string, page: number, read: () => Promise<ViewPage>) {
  return queryOptions({ queryFn: read, queryKey: ['view', viewId, 'page', page] });
}

function indexOptions(
  viewId: string,
  version: number,
  entryId: string | null,
  find: () => Promise<number>,
) {
  return queryOptions({
    enabled: entryId !== null,
    queryFn: find,
    queryKey: ['view', viewId, 'index', version, entryId],
  });
}

function facetsOptions(api: PhotosAPI, viewId: string) {
  return queryOptions({
    queryFn: () => api.viewFacets(viewId),
    queryKey: ['view', viewId, 'facets'],
  });
}

/**
 * A view the worker holds of the library: a folder's entries, or everything inside it, in
 * order and narrowed as its spec says. The window holds only the pages of it that it shows,
 * as queries of the library's client, so a view of a million photos costs what a screenful
 * does. The worker makes a new version as the folder is read or changes, and pages read at an
 * older one show until they are read again.
 */
export function createGalleryView(
  api: PhotosAPI,
  queries: QueryClient,
  spec: ViewSpec,
  opened: ViewState,
  owner: ViewOwner,
): GalleryView {
  const { viewId } = opened;
  const listeners = new Set<() => void>();
  let state = opened;

  /** Reads a page at the latest version, again if a newer one came while it was read. */
  async function readPage(page: number): Promise<ViewPage> {
    for (;;) {
      const { version } = state;
      const rows = await api.viewRows(viewId, version, page * VIEW_PAGE, VIEW_PAGE);
      // A version that went before its rows were read has a newer one since.
      if (version === state.version) {
        owner.found(rows ?? []);
        return { rows: rows ?? [], version };
      }
    }
  }

  function pageQuery(page: number) {
    return pageOptions(viewId, page, () => readPage(page));
  }

  function indexQuery(entryId: string | null) {
    const { version } = state;
    return indexOptions(viewId, version, entryId, async () => {
      const id = entryId ?? '';
      const index = await api.viewIndexOf(viewId, version, id);
      const moved = owner.follow(id);
      return index === -1 && moved !== id ? api.viewIndexOf(viewId, version, moved) : index;
    });
  }

  return {
    close() {
      queries.removeQueries({ queryKey: ['view', viewId] });
      api.closeView(viewId).catch(() => null);
    },
    async entries(start, end) {
      const last = Math.min(end, state.count, start + MAX_VIEW_ROWS);
      const pages = await Promise.all(
        pagesOf(start, last).map((page) => queries.fetchQuery(pageQuery(page))),
      );
      const first = Math.floor(start / VIEW_PAGE) * VIEW_PAGE;
      return pages.flatMap((page) => page.rows).slice(start - first, last - first);
    },
    async entry(index) {
      const inside = index >= 0 && index < state.count;
      const page = inside
        ? await queries.fetchQuery(pageQuery(Math.floor(index / VIEW_PAGE)))
        : null;
      return page?.rows[index % VIEW_PAGE];
    },
    facetsQuery: () => facetsOptions(api, viewId),
    getSnapshot: () => state,
    indexQuery,
    know(entryId, index) {
      queries.setQueryData(indexQuery(entryId).queryKey, index);
    },
    pageQuery,
    peek(index) {
      const page = queries.getQueryData(pageQuery(Math.floor(index / VIEW_PAGE)).queryKey);
      return page?.rows[index % VIEW_PAGE];
    },
    spec,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    update(next) {
      const changed = next.version !== state.version;
      state = next;
      if (changed) {
        // A read under way, such as one a loader waits for, carries on and reads again itself.
        queries
          .invalidateQueries({ queryKey: ['view', viewId] }, { cancelRefetch: false })
          .catch(() => null);
      }
      for (const listener of listeners) {
        listener();
      }
    },
    viewId,
  };
}
