import {
  debug,
  MAX_VIEW_ROWS,
  type PhotoEntry,
  type PhotosAPI,
  type TrashAPI,
  type TrashChoices,
  type ViewSpec,
  type ViewState,
} from '@prism/shared';
import { keepPreviousData, type QueryClient, queryOptions } from '@tanstack/react-query';

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
  /** Plans moving the view's matches to the Trash. */
  trash: TrashAPI;
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
  /** The version of each page's newest read, which shows while a newer one is read. */
  private readonly newest = new Map<number, number>();

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

  /**
   * Takes the worker's news of the view. Queries name the version they read, so a new one
   * reads again what is on screen, showing what was read before until it has.
   */
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
      this.forgetOldPages();
    }
    for (const listener of this.listeners) {
      listener();
    }
  }

  /*
   * The queries take the version they read from their caller rather than from the view's
   * state: React Compiler memoizes what a component asks for by what it passes, so a version
   * read from inside would leave a component asking for the one it first rendered.
   */

  /** The page's rows as of `version`; the last read shows until they are read. */
  pageQuery(page: number, version: number) {
    return queryOptions({
      placeholderData: () => this.lastRead(page),
      queryFn: () => this.readPage(page, version),
      queryKey: this.pageKey(page, version),
    });
  }

  private pageKey(page: number, version: number) {
    return ['view', this.viewId, 'page', version, page] as const;
  }

  /**
   * Asks the worker something as of `version`, and again as of the latest whenever the version
   * asked about has gone, which the worker answers with `null`: a version that has gone has a
   * newer one since. Says which version answered, which is `null` only if the latest has gone
   * too, as when the view closes.
   */
  private async atNewest<Answer>(
    version: number,
    ask: (version: number) => Promise<Answer | null>,
  ): Promise<{ answer: Answer | null; version: number }> {
    for (let asked = version; ; asked = this.state.version) {
      const answer = await ask(asked);
      if (answer !== null || asked === this.state.version) {
        return { answer, version: asked };
      }
    }
  }

  /** Reads a page as of `version`, or the latest if that has gone. */
  private async readPage(page: number, version: number): Promise<ViewPage> {
    const read = await this.atNewest(version, async (asked) => {
      const rows = await this.api.viewRows(this.viewId, asked, page * VIEW_PAGE, VIEW_PAGE);
      log('%s page %d at version %d: %o rows', this.viewId, page, asked, rows?.length ?? null);
      return rows;
    });
    const rows = read.answer ?? [];
    this.owner.found(rows);
    if (read.version > (this.newest.get(page) ?? -1)) {
      this.newest.set(page, read.version);
    }
    return { rows, version: read.version };
  }

  /** The newest read of `page`, at any version. */
  private lastRead(page: number): ViewPage | undefined {
    const version = this.newest.get(page);
    return version === undefined
      ? undefined
      : this.queries.getQueryData<ViewPage>(this.pageKey(page, version));
  }

  /**
   * Lets go of pages read at older versions that nothing shows and a newer read of the same
   * page replaces, so a view that changes often keeps one read of each page.
   */
  private forgetOldPages() {
    const cache = this.queries.getQueryCache();
    for (const query of cache.findAll({ queryKey: ['view', this.viewId, 'page'] })) {
      const { 3: version, 4: page } = query.queryKey;
      const newest = this.newest.get(Number(page)) ?? -1;
      if (Number(version) < newest && query.getObserversCount() === 0) {
        cache.remove(query);
      }
    }
  }

  /** The entry at `index`, as its page was last read, if it has been. */
  peek(index: number): PhotoEntry | undefined {
    return this.lastRead(Math.floor(index / VIEW_PAGE))?.rows[index % VIEW_PAGE];
  }

  /** Reads the entry at `index`. */
  async entry(index: number): Promise<PhotoEntry | undefined> {
    if (index < 0 || index >= this.state.count) {
      return undefined;
    }
    const page = await this.queries.fetchQuery(
      this.pageQuery(Math.floor(index / VIEW_PAGE), this.state.version),
    );
    return page.rows[index % VIEW_PAGE];
  }

  /** Reads the entries from `start` up to `end`, as a view opens with them. */
  async entries(start: number, end: number): Promise<PhotoEntry[]> {
    const last = Math.min(end, this.state.count, start + MAX_VIEW_ROWS);
    const pages = await Promise.all(
      pagesOf(start, last).map((page) =>
        this.queries.fetchQuery(this.pageQuery(page, this.state.version)),
      ),
    );
    const first = Math.floor(start / VIEW_PAGE) * VIEW_PAGE;
    return pages.flatMap((page) => page.rows).slice(start - first, last - first);
  }

  /** Where `id` is as of `version`, under its new name if renamed; `null` if it has gone. */
  private async placeAt(version: number, id: string): Promise<number | null> {
    const index = await this.api.viewIndexOf(this.viewId, version, id);
    const moved = this.owner.follow(id);
    return index === -1 && moved !== id ? this.api.viewIndexOf(this.viewId, version, moved) : index;
  }

  /** Where `entryId` is as of the latest version, found under its new name if renamed. */
  indexQuery(entryId: string | null, version: number) {
    return queryOptions({
      enabled: entryId !== null,
      queryFn: async () => {
        const id = entryId ?? '';
        const { answer } = await this.atNewest(version, async (asked) => {
          const index = await this.placeAt(asked, id);
          log('%s at version %d has %s at %o', this.viewId, asked, id, index);
          return index;
        });
        return answer ?? -1;
      },
      queryKey: ['view', this.viewId, 'index', version, entryId],
    });
  }

  /** Notes where an entry chosen on screen is, so nothing waits to ask the worker. */
  know(entryId: string, index: number): void {
    this.queries.setQueryData(this.indexQuery(entryId, this.state.version).queryKey, index);
  }

  /**
   * What the view's folder has of each field to filter by, counted again at each version. The
   * worker counts the folder whatever the search and filters, so another view of it, such as
   * the one before the last key typed, has the same counts: they show until these are counted,
   * rather than the suggestions emptying and losing their highlight with each key.
   */
  facetsQuery(version: number) {
    const folder = JSON.stringify([this.spec.directoryId, this.spec.recursive]);
    return queryOptions({
      placeholderData: (previous, query) => (query?.queryKey[4] === folder ? previous : undefined),
      queryFn: () => this.api.viewFacets(this.viewId),
      queryKey: ['view', this.viewId, 'facets', version, folder],
    });
  }

  /** What the view's folders held that could not be read, as of `version`. */
  errorsQuery(version: number) {
    return queryOptions({
      queryFn: () => this.api.viewErrors(this.viewId),
      queryKey: ['view', this.viewId, 'errors', version],
    });
  }

  /**
   * What moving the view's entries to the Trash would do as of `version`, as `choices` decide;
   * see `viewTrashPlan`. The last plan shows until the next is made, so deciding never flashes.
   */
  trashPlanQuery(version: number, choices: TrashChoices) {
    return queryOptions({
      placeholderData: keepPreviousData,
      queryFn: async () => {
        const { answer } = await this.atNewest(version, (asked) =>
          this.owner.trash.viewTrashPlan(this.viewId, asked, choices),
        );
        return answer;
      },
      queryKey: ['view', this.viewId, 'trash', version, choices],
    });
  }

  /** Every entry that plan would move, one by one; see `viewTrashFiles`. */
  trashFilesQuery(version: number, choices: TrashChoices) {
    return queryOptions({
      placeholderData: keepPreviousData,
      queryFn: async () => {
        const { answer } = await this.atNewest(version, (asked) =>
          this.owner.trash.viewTrashFiles(this.viewId, asked, choices),
        );
        return answer;
      },
      queryKey: ['view', this.viewId, 'trash-files', version, choices],
    });
  }

  /** Lets go of the view, in the worker and here. */
  close(): void {
    this.queries.removeQueries({ queryKey: ['view', this.viewId] });
    this.api.closeView(this.viewId).catch(() => null);
  }
}
