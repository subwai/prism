import type { Catalog } from '#photos/catalog/client';
import type { ViewVersion } from '#photos/catalog/views';
import { Enricher } from '#photos/enricher';
import type { ExifDetails } from '#photos/exif';
import { Indexer, type IndexRun } from '#photos/indexer';
import { requireString, requireViewRange, requireViewSpec } from '#photos/validate';
import type { FolderChange, ViewFacets, ViewSpec, ViewState } from '@prism/shared';
import { randomUUID } from 'node:crypto';

// Views the folder's windows may have open at once; opening another closes the one opened
// longest ago. Each window keeps a few, and typing a search opens one a keystroke.
const MAX_VIEWS = 16,
  // A view waits this long for its own folder to be read before showing what the catalog has.
  FIRST_FOLDER_MS = 400;

/** A view a window has open, and the read of the folders it shows. */
interface OpenView {
  viewId: string;
  spec: ViewSpec;
  version: ViewVersion;
  run: IndexRun;
}

/** A read of a scope's folders, shared by the views of it, and stopped once none is open. */
interface SharedRun {
  run: IndexRun;
  controller: AbortController;
  views: Set<string>;
}

function scopeKey({ directoryId, recursive }: ViewSpec) {
  return JSON.stringify([directoryId, recursive]);
}

export interface LibraryViewSources {
  root: string;
  catalog: Catalog;
  exif: ExifDetails;
  /** Finds an entry on disk, checking it is inside `root`. */
  resolve: (entryId: string) => Promise<string>;
  /** Whether thumbnails or originals are being made, which background reads make way for. */
  busy: () => boolean;
  signal: AbortSignal;
}

/** Whether a view wants photos' details read now rather than in the background. */
function needsDetails({ sort, filter, suggesting }: ViewSpec) {
  return (
    sort === 'taken' ||
    suggesting ||
    filter.camera.length > 0 ||
    filter.lens.length > 0 ||
    filter.tag.length > 0
  );
}

function stateOf({ viewId, version, run }: OpenView): ViewState {
  return {
    count: version.count,
    error: run.error,
    errors: run.errors,
    loading: !run.finished,
    unread: version.unread,
    version: version.version,
    viewId,
  };
}

function delay(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * The views a folder's windows have open, as queries of the catalog: each reads its folders
 * into the catalog as it goes, and the enricher reads photos' details around them. Windows
 * hear of each new version through `onView`.
 */
export class LibraryViews {
  private readonly indexer: Indexer;
  private readonly enricher: Enricher;
  /** Most recently opened last. */
  private readonly views = new Map<string, OpenView>();
  private readonly runs = new Map<string, SharedRun>();
  private readonly listeners = new Set<(state: ViewState) => void>();

  constructor(private readonly sources: LibraryViewSources) {
    const { catalog, root, resolve, signal } = sources;
    this.indexer = new Indexer({ catalog, resolve, root, signal });
    this.enricher = new Enricher({ ...sources, busy: () => sources.busy() });
    catalog.onEvent(({ view }) => {
      const open = this.views.get(view.viewId);
      if (open) {
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
      const run = this.indexer.index(
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

  /** Reads photos' details at full speed while any open view wants them now. */
  private wantDetails() {
    this.enricher.want([...this.views.values()].some((view) => needsDetails(view.spec)));
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
    await Promise.race([run.first, delay(FIRST_FOLDER_MS)]);
    view.version = await this.sources.catalog.call('openView', viewId, spec);
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

  indexOf(viewId: string, version: number, entryId: string): Promise<number> {
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
    const { catalog, signal } = this.sources;
    const listed = described.flatMap(({ entry }) => (entry ? [entry] : []));
    const removed = described.filter(({ entry }) => !entry).map(({ id }) => id);
    if (listed.length > 0) {
      catalog.write({ listed });
      this.enricher.nudge();
    }
    if (removed.length > 0) {
      catalog.write({ removed });
      for (const id of removed) {
        this.indexer.forgetInside(id);
      }
    }
    for (const { entry, listingChanged } of described) {
      if (entry?.kind === 'directory' && listingChanged) {
        this.indexer.forgetInside(entry.id);
        this.indexer.index({ directoryId: entry.id, recursive: true }, signal);
      }
    }
  }

  /**
   * Folders to read again, as they changed. Without folders, every open view reads all of its
   * folders again; the catalog shows them meanwhile.
   */
  forget(folderIds?: string[]): void {
    this.indexer.forget(folderIds);
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
