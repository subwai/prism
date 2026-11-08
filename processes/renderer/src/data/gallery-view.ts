import {
  debug,
  MAX_VIEW_ROWS,
  type PhotoEntry,
  type PhotosAPI,
  type ViewSpec,
  type ViewState,
} from '@prism/shared';
import { type QueryClient, queryOptions } from '@tanstack/react-query';

const log = debug('renderer:views');

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
export class GalleryView {
  private state: ViewState;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly api: PhotosAPI,
    private readonly queries: QueryClient,
    readonly spec: ViewSpec,
    state: ViewState,
    private readonly owner: ViewOwner,
  ) {
    this.state = state;
  }

  get viewId(): string {
    return this.state.viewId;
  }

  /** `useSyncExternalStore` source of the view's state. */
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): ViewState => this.state;

  /** Takes the worker's news of the view. A new version reads again what is on screen. */
  update(state: ViewState): void {
    const changed = state.version !== this.state.version;
    log(
      '%s at version %d, was %d: %d entries',
      this.viewId,
      state.version,
      this.state.version,
      state.count,
    );
    this.state = state;
    if (changed) {
      // A read under way, such as one a loader waits for, carries on and reads again itself.
      // Places are asked at a version and never change, and the new one asks afresh: asking
      // again at an old version the worker has let go of would find nothing there.
      this.queries
        .invalidateQueries(
          {
            predicate: ({ queryKey: [scope, viewId, kind] }) =>
              scope === 'view' && viewId === this.viewId && kind !== 'index',
          },
          { cancelRefetch: false },
        )
        .catch(() => null);
    }
    for (const listener of this.listeners) {
      listener();
    }
  }

  pageQuery(page: number) {
    return queryOptions({
      queryFn: () => this.readPage(page),
      queryKey: ['view', this.viewId, 'page', page],
    });
  }

  /** Reads a page at the latest version, again if a newer one came while it was read. */
  private async readPage(page: number): Promise<ViewPage> {
    for (;;) {
      const { version } = this.state;
      const rows = await this.api.viewRows(this.viewId, version, page * VIEW_PAGE, VIEW_PAGE);
      // A version that went before its rows were read has a newer one since.
      log('%s page %d at version %d: %d rows', this.viewId, page, version, rows?.length ?? 0);
      if (version === this.state.version) {
        this.owner.found(rows ?? []);
        return { rows: rows ?? [], version };
      }
    }
  }

  /** The entry at `index`, if its page has been read. */
  peek(index: number): PhotoEntry | undefined {
    const page = this.queries.getQueryData(this.pageQuery(Math.floor(index / VIEW_PAGE)).queryKey);
    return page?.rows[index % VIEW_PAGE];
  }

  /** Reads the entry at `index`. */
  async entry(index: number): Promise<PhotoEntry | undefined> {
    if (index < 0 || index >= this.state.count) {
      return undefined;
    }
    const page = await this.queries.fetchQuery(this.pageQuery(Math.floor(index / VIEW_PAGE)));
    return page.rows[index % VIEW_PAGE];
  }

  /** Reads the entries from `start` up to `end`, as a view opens with them. */
  async entries(start: number, end: number): Promise<PhotoEntry[]> {
    const last = Math.min(end, this.state.count, start + MAX_VIEW_ROWS);
    const pages = await Promise.all(
      pagesOf(start, last).map((page) => this.queries.fetchQuery(this.pageQuery(page))),
    );
    const first = Math.floor(start / VIEW_PAGE) * VIEW_PAGE;
    return pages.flatMap((page) => page.rows).slice(start - first, last - first);
  }

  /** Where `entryId` is as of the latest version, found under its new name if renamed. */
  indexQuery(entryId: string | null) {
    const { version } = this.state;
    return queryOptions({
      enabled: entryId !== null,
      queryFn: async () => {
        const id = entryId ?? '';
        const index = await this.api.viewIndexOf(this.viewId, version, id);
        const moved = this.owner.follow(id);
        const found =
          index === -1 && moved !== id
            ? await this.api.viewIndexOf(this.viewId, version, moved)
            : index;
        log('%s at version %d has %s at %d', this.viewId, version, id, found);
        return found;
      },
      queryKey: ['view', this.viewId, 'index', version, entryId],
    });
  }

  /** Notes where an entry chosen on screen is, so nothing waits to ask the worker. */
  know(entryId: string, index: number): void {
    this.queries.setQueryData(this.indexQuery(entryId).queryKey, index);
  }

  /** What the view's photos have of each field to filter by. */
  facetsQuery() {
    return queryOptions({
      queryFn: () => this.api.viewFacets(this.viewId),
      queryKey: ['view', this.viewId, 'facets'],
    });
  }

  /** Lets go of the view, in the worker and here. */
  close(): void {
    this.queries.removeQueries({ queryKey: ['view', this.viewId] });
    this.api.closeView(this.viewId).catch(() => null);
  }
}
