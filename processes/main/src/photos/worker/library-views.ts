import { requireString, requireViewRange, requireViewSpec } from '#photos/validate';
import { Enricher } from '#photos/worker/enricher';
import type { Indexer } from '#photos/worker/indexer';
import {
  type OpenView,
  scopeKey,
  type SharedRun,
  stateOf,
  wantsDetailsNow,
} from '#photos/worker/open-views';
import type { Catalog } from '@prism/catalog';
import type { FolderChange, ReadError, ViewFacets, ViewSpec, ViewState } from '@prism/shared';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

// Views the folder's windows may have open at once; opening another closes the one opened
// longest ago. Each window keeps a few, and typing a search opens one a keystroke.
const MAX_VIEWS = 16,
  // A view waits this long for its own folder to be read before showing what the catalog has.
  FIRST_FOLDER_MS = 400;

export interface LibraryViewSources {
  root: string;
  catalog: Catalog;
  /** Reads the library's folders into the catalog. */
  indexer: Indexer;
  /** Finds an entry on disk, checking it is inside `root`. */
  resolve: (entryId: string) => Promise<string>;
  /** Whether thumbnails or originals are being made, which background reads make way for. */
  busy: () => boolean;
  signal: AbortSignal;
}

/**
 * The views a folder's windows have open, as queries of the catalog: each reads its folders
 * into the catalog as it goes, and the enricher reads photos' details around them. Windows
 * hear of each new version through `onView`.
 */
export class LibraryViews {
  private readonly enricher: Enricher;
  /** Most recently opened last. */
  private readonly views = new Map<string, OpenView>();
  private readonly runs = new Map<string, SharedRun>();
  private readonly listeners = new Set<(state: ViewState) => void>();
  /** Batches of changes waiting for the versions that hold them, which they tell themselves. */
  private holding = 0;

  constructor(private readonly sources: LibraryViewSources) {
    this.enricher = new Enricher(sources);
    sources.catalog.onEvent(({ view }) => {
      const open = this.views.get(view.viewId);
      // A version made before a batch's own may arrive after it, and is no news.
      if (open && view.version > open.version.version) {
        open.version = view;
        this.tell(open);
      }
      // A new version may hold photos the enricher has yet to read.
      this.enricher.nudge();
    });
  }

  onView(listener: (state: ViewState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private tell(view: OpenView) {
    if (this.holding > 0) {
      return;
    }
    const state = stateOf(view);
    for (const listener of this.listeners) {
      listener(state);
    }
  }

  /**
   * Reads the folders `spec` shows, telling the view once they are all read. Views of the same
   * scope, such as a search's as it is typed, share one read; `again` starts another, as a
   * refresh does.
   */
  private read(view: OpenView, again = false) {
    const { spec } = view;
    const key = scopeKey(spec);
    let shared = this.runs.get(key);
    if (again || !shared) {
      shared?.controller.abort();
      const controller = new AbortController();
      const run = this.sources.indexer.index(
        { directoryId: spec.directoryId, recursive: spec.recursive },
        controller.signal,
      );
      shared = { controller, run, views: new Set(shared?.views) };
      this.runs.set(key, shared);
    }
    shared.views.add(view.viewId);
    const { run } = shared;
    view.run = run;
    run.done
      .then(async () => {
        // Its last rows may still wait for the catalog's next version, and photos to read.
        const version = await this.sources.catalog.call('refreshView', view.viewId);
        this.enricher.nudge();
        if (version && this.views.get(view.viewId) === view && view.run === run) {
          view.version = version;
          this.tell(view);
        }
      })
      .catch(() => null);
    return run;
  }

  /**
   * The open views' states with every write so far, made again now where the catalog changed
   * under them, for a batch of changes to tell with them. Versions the catalog makes meanwhile
   * are held back, so windows hear of a change with the versions that hold it, never after.
   */
  async current(): Promise<ViewState[]> {
    this.holding += 1;
    try {
      this.sources.catalog.flush();
      const open = [...this.views.values()];
      const versions = await Promise.all(
        open.map((view) => this.sources.catalog.call('refreshView', view.viewId)),
      );
      for (const [at, view] of open.entries()) {
        const version = versions[at];
        if (version && version.version >= view.version.version) {
          view.version = version;
        }
      }
      return open
        .filter((view) => this.views.get(view.viewId) === view)
        .map((view) => stateOf(view));
    } finally {
      this.holding -= 1;
    }
  }

  /** Reads photos' details at full speed while any open view wants them now. */
  private wantDetails() {
    this.enricher.want([...this.views.values()].some((view) => wantsDetailsNow(view.spec)));
    this.enricher.start();
  }

  /**
   * Opens a view of what `spec` asks for. It waits a moment for the view's own folder, so a
   * folder read for the first time opens with its entries rather than empty.
   */
  async open(spec: ViewSpec): Promise<ViewState> {
    requireViewSpec(spec);
    if (spec.directoryId !== '.') {
      await this.sources.resolve(spec.directoryId);
    }
    for (const viewId of this.views.keys()) {
      if (this.views.size < MAX_VIEWS) {
        break;
      }
      await this.close(viewId);
    }
    const viewId = randomUUID();
    const view = {
      spec,
      version: { count: 0, unread: 0, version: 0 },
      viewId,
    } as OpenView;
    const run = this.read(view);
    try {
      await Promise.race([run.first, delay(FIRST_FOLDER_MS)]);
      view.version = await this.sources.catalog.call('openView', viewId, spec);
    } catch (error) {
      // Never opened, so nothing will close it to stop the read it joined.
      this.release(view);
      throw error;
    }
    this.views.set(viewId, view);
    this.wantDetails();
    return stateOf(view);
  }

  private require(viewId: unknown): OpenView {
    requireString(viewId);
    const view = this.views.get(viewId);
    if (!view) {
      throw new Error('The view is closed.');
    }
    return view;
  }

  rows(viewId: string, version: number, start: number, count: number) {
    requireViewRange(version, start, count);
    this.require(viewId);
    return this.sources.catalog.call('viewRows', viewId, version, start, count);
  }

  indexOf(viewId: string, version: number, entryId: string): Promise<number | null> {
    requireViewRange(version, 0, 0);
    requireString(entryId);
    this.require(viewId);
    return this.sources.catalog.call('viewIndexOf', viewId, version, entryId);
  }

  async facets(viewId: string): Promise<ViewFacets> {
    this.require(viewId);
    const facets = await this.sources.catalog.call('viewFacets', viewId);
    if (!facets) {
      throw new Error('The view is closed.');
    }
    return facets;
  }

  /** What the view's folders held that could not be read, as far as its read has got. */
  errors(viewId: string): ReadError[] {
    return this.require(viewId).run.errors;
  }

  async close(viewId: string): Promise<void> {
    requireString(viewId);
    const view = this.views.get(viewId);
    if (!view) {
      return;
    }
    this.views.delete(viewId);
    this.release(view);
    this.wantDetails();
    await this.sources.catalog.call('closeView', viewId);
  }

  /** Stops the read of the view's scope once no other view of it is open. */
  private release(view: OpenView) {
    const key = scopeKey(view.spec);
    const shared = this.runs.get(key);
    shared?.views.delete(view.viewId);
    if (shared?.views.size === 0) {
      shared.controller.abort();
      this.runs.delete(key);
    }
  }

  /**
   * Writes what changed on disk to the catalog, so views show it without reading their folders
   * again. A folder that came, as one moved in does, raises no events for what it holds, so it
   * is read in full.
   */
  apply(described: FolderChange[]): void {
    const { catalog, indexer, signal } = this.sources;
    const listed = described.flatMap(({ entry }) => (entry ? [entry] : []));
    const removed = described.filter(({ entry }) => !entry).map(({ id }) => id);
    if (listed.length > 0) {
      catalog.write({ listed });
      this.enricher.nudge();
    }
    if (removed.length > 0) {
      catalog.write({ removed });
      for (const id of removed) {
        indexer.forgetInside(id);
      }
    }
    for (const { entry, listingChanged } of described) {
      if (entry?.kind === 'directory' && listingChanged) {
        indexer.forgetInside(entry.id);
        indexer.index({ directoryId: entry.id, recursive: true }, signal);
      }
    }
  }

  /**
   * Folders to read again, as they changed. Without folders, every open view reads all of its
   * folders again; the catalog shows them meanwhile.
   */
  forget(folderIds?: string[]): void {
    this.sources.indexer.forget(folderIds);
    if (folderIds) {
      return;
    }
    const started = new Set<string>();
    for (const view of this.views.values()) {
      const key = scopeKey(view.spec);
      this.read(view, !started.has(key));
      started.add(key);
      this.tell(view);
    }
  }

  closeAll(): void {
    for (const { controller } of this.runs.values()) {
      controller.abort();
    }
    this.runs.clear();
    this.views.clear();
  }
}
