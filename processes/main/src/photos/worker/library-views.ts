import { requireString, requireViewRange, requireViewSpec } from '#photos/validate';
import { createEnricher } from '#photos/worker/enricher';
import type { Indexer, IndexRun } from '#photos/worker/indexer';
import type { Catalog, ViewVersion } from '@prism/catalog';
import type { FolderChange, PhotoEntry, ViewFacets, ViewSpec, ViewState } from '@prism/shared';
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
  /** Reads the library's folders into the catalog. */
  indexer: Indexer;
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
export interface LibraryViews {
  onView: (listener: (state: ViewState) => void) => () => void;
  /**
   * Opens a view of what `spec` asks for. It waits a moment for the view's own folder, so a
   * folder read for the first time opens with its entries rather than empty.
   */
  open: (spec: ViewSpec) => Promise<ViewState>;
  rows: (
    viewId: string,
    version: number,
    start: number,
    count: number,
  ) => Promise<PhotoEntry[] | null>;
  indexOf: (viewId: string, version: number, entryId: string) => Promise<number>;
  facets: (viewId: string) => Promise<ViewFacets>;
  close: (viewId: string) => Promise<void>;
  /**
   * Writes what changed on disk to the catalog, so views show it without reading their folders
   * again. A folder that came, as one moved in does, raises no events for what it holds, so it
   * is read in full.
   */
  apply: (described: FolderChange[]) => void;
  /**
   * Folders to read again, as they changed. Without folders, every open view reads all of its
   * folders again; the catalog shows them meanwhile.
   */
  forget: (folderIds?: string[]) => void;
  closeAll: () => void;
}

export function createLibraryViews(sources: LibraryViewSources): LibraryViews {
  const { catalog, indexer, signal } = sources;
  const enricher = createEnricher(sources);
  /** Most recently opened last. */
  const views = new Map<string, OpenView>();
  const runs = new Map<string, SharedRun>();
  const listeners = new Set<(state: ViewState) => void>();

  function tell(view: OpenView) {
    const state = stateOf(view);
    for (const listener of listeners) {
      listener(state);
    }
  }

  catalog.onEvent(({ view }) => {
    const shown = views.get(view.viewId);
    if (shown) {
      shown.version = view;
      tell(shown);
    }
    // A new version may hold photos the enricher has yet to read.
    enricher.nudge();
  });

  /**
   * Reads the folders `spec` shows, telling the view once they are all read. Views of the same
   * scope, such as a search's as it is typed, share one read; `again` starts another, as a
   * refresh does.
   */
  function read(view: OpenView, again = false) {
    const { spec } = view;
    const key = scopeKey(spec);
    let shared = runs.get(key);
    if (again || !shared) {
      shared?.controller.abort();
      const controller = new AbortController();
      const run = indexer.index(
        { directoryId: spec.directoryId, recursive: spec.recursive },
        controller.signal,
      );
      shared = { controller, run, views: new Set(shared?.views) };
      runs.set(key, shared);
    }
    shared.views.add(view.viewId);
    const { run } = shared;
    view.run = run;
    run.done
      .then(async () => {
        // Its last rows may still wait for the catalog's next version, and photos to read.
        const version = await catalog.call('refreshView', view.viewId);
        enricher.nudge();
        if (version && views.get(view.viewId) === view && view.run === run) {
          view.version = version;
          tell(view);
        }
      })
      .catch(() => null);
    return run;
  }

  /** Reads photos' details at full speed while any open view wants them now. */
  function wantDetails() {
    enricher.want([...views.values()].some((view) => needsDetails(view.spec)));
    enricher.start();
  }

  function require(viewId: unknown): OpenView {
    requireString(viewId);
    const view = views.get(viewId);
    if (!view) {
      throw new Error('The view is closed.');
    }
    return view;
  }

  /** Stops the read of the view's scope once no other view of it is open. */
  function release(view: OpenView) {
    const key = scopeKey(view.spec);
    const shared = runs.get(key);
    shared?.views.delete(view.viewId);
    if (shared?.views.size === 0) {
      shared.controller.abort();
      runs.delete(key);
    }
  }

  async function close(viewId: string) {
    requireString(viewId);
    const view = views.get(viewId);
    if (!view) {
      return;
    }
    views.delete(viewId);
    release(view);
    wantDetails();
    await catalog.call('closeView', viewId);
  }

  async function open(spec: ViewSpec): Promise<ViewState> {
    requireViewSpec(spec);
    if (spec.directoryId !== '.') {
      await sources.resolve(spec.directoryId);
    }
    for (const viewId of views.keys()) {
      if (views.size < MAX_VIEWS) {
        break;
      }
      await close(viewId);
    }
    const viewId = randomUUID();
    const view = { spec, version: { count: 0, unread: 0, version: 0 }, viewId } as OpenView;
    const run = read(view);
    await Promise.race([run.first, delay(FIRST_FOLDER_MS)]);
    view.version = await catalog.call('openView', viewId, spec);
    views.set(viewId, view);
    wantDetails();
    return stateOf(view);
  }

  return {
    apply(described) {
      const listed = described.flatMap(({ entry }) => (entry ? [entry] : []));
      const removed = described.filter(({ entry }) => !entry).map(({ id }) => id);
      if (listed.length > 0) {
        catalog.write({ listed });
        enricher.nudge();
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
    },
    close,
    closeAll() {
      for (const { controller } of runs.values()) {
        controller.abort();
      }
      runs.clear();
      views.clear();
    },
    async facets(viewId) {
      require(viewId);
      const facets = await catalog.call('viewFacets', viewId);
      if (!facets) {
        throw new Error('The view is closed.');
      }
      return facets;
    },
    forget(folderIds) {
      indexer.forget(folderIds);
      if (folderIds) {
        return;
      }
      const started = new Set<string>();
      for (const view of views.values()) {
        const key = scopeKey(view.spec);
        read(view, !started.has(key));
        started.add(key);
        tell(view);
      }
    },
    indexOf(viewId, version, entryId) {
      requireViewRange(version, 0, 0);
      requireString(entryId);
      require(viewId);
      return catalog.call('viewIndexOf', viewId, version, entryId);
    },
    onView(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    open,
    rows(viewId, version, start, count) {
      requireViewRange(version, start, count);
      require(viewId);
      return catalog.call('viewRows', viewId, version, start, count);
    },
  };
}
