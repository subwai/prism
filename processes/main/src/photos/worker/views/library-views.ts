import { requireString, requireViewRange, requireViewSpec } from '#photos/validate';
import type { Share } from '#photos/worker/disk/share/share';
import type { Indexer } from '#photos/worker/indexer/indexer';
import type { Scheduler } from '#photos/worker/scheduler/scheduler';
import { DetailsReader } from '#photos/worker/views/details-reader';
import {
  needsDetailsNow,
  type OpenView,
  scopeKey,
  type SharedIndexRun,
  viewStateOf,
} from '#photos/worker/views/open-view';
import type { Catalog } from '@prism/catalog';
import {
  Listeners,
  type ReadError,
  type ViewFacets,
  type ViewSpec,
  type ViewState,
} from '@prism/shared';
import { randomUUID } from 'node:crypto';

// Views the folder's windows may have open at once; opening another closes the one opened
// longest ago. Each window keeps a few, and typing a search opens one a keystroke.
const MAX_VIEWS = 16;

export interface LibraryViewSources {
  root: string;
  catalog: Catalog;
  /** Reads the library's folders into the catalog. */
  indexer: Indexer;
  /** Orders every read of the disk, the details reader's among them. */
  scheduler: Scheduler;
  /** Whether the library's folder can be reached; see `filesOwnFailures`. */
  share: Share;
  signal: AbortSignal;
}

/**
 * The views a folder's windows have open, as queries of the catalog. Each view reads its folders
 * into the catalog as it goes, and the details reader reads photos' details around them. Windows
 * learn of each new version through `onNewVersion`.
 */
export class LibraryViews {
  private readonly detailsReader: DetailsReader;
  /** Most recently opened last. */
  private readonly views = new Map<string, OpenView>();
  private readonly runs = new Map<string, SharedIndexRun>();
  private readonly listeners = new Listeners<ViewState>();
  /**
   * How many batches of changes are waiting for the view versions that include them. While any
   * are, new versions are not sent on their own, because each batch sends them with its changes.
   */
  private heldBatches = 0;

  constructor(private readonly sources: LibraryViewSources) {
    this.detailsReader = new DetailsReader(sources);
    sources.catalog.onEvent(({ view }) => {
      const open = this.views.get(view.viewId);
      // A version made before a batch's own may arrive after it, and then has nothing new.
      if (open && view.version > open.version.version) {
        open.version = view;
        this.sendState(open);
      }
      // A new version may hold photos the details reader has yet to read.
      this.detailsReader.wake();
    });
    // Skipped photos are read again once a forget is done.
    sources.catalog.onDetailsForgotten(() => this.detailsReader.wake());
  }

  onNewVersion(listener: (state: ViewState) => void): () => void {
    return this.listeners.add(listener);
  }

  private sendState(view: OpenView) {
    if (this.heldBatches > 0) {
      return;
    }
    const state = viewStateOf(view);
    this.listeners.tell(state);
  }

  /**
   * Reads the folders the view shows that changed, and sends its state once they are all read;
   * see `FolderStamp`. Views of the same scope, such as a search's as it is typed, share one read.
   * `again` starts another read of every folder in full, as a refresh does.
   */
  private readFolders(view: OpenView, again = false) {
    const { spec } = view;
    const key = scopeKey(spec);
    let shared = this.runs.get(key);
    if (again || !shared) {
      shared?.controller.abort();
      const controller = new AbortController();
      const run = this.sources.indexer.index(
        { directoryId: spec.directoryId, recursive: spec.recursive },
        controller.signal,
        { fullRead: again },
      );
      shared = { controller, run, views: new Set(shared?.views) };
      this.runs.set(key, shared);
    }
    shared.views.add(view.viewId);
    const { run } = shared;
    view.run = run;
    run.done
      .then(async () => {
        // Its last rows may still be waiting for the catalog's next version, and photos to read.
        await this.sources.catalog.committed();
        const version = await this.sources.catalog.call('refreshView', view.viewId);
        this.detailsReader.wake();
        if (version && this.views.get(view.viewId) === view && view.run === run) {
          view.version = version;
          this.sendState(view);
        }
      })
      .catch(() => null);
    return run;
  }

  /**
   * The open views' states with every write so far, rebuilt now where the catalog changed under
   * them, for a batch of changes to send with them. Versions the catalog makes meanwhile are held
   * back, so windows receive a change together with the versions that include it, never after.
   */
  async current(): Promise<ViewState[]> {
    this.heldBatches += 1;
    try {
      await this.sources.catalog.committed();
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
        .map((view) => viewStateOf(view));
    } finally {
      this.heldBatches -= 1;
    }
  }

  /** Reads photos' details at full speed while any open view wants them now. */
  private updateDetailsUrgency() {
    this.detailsReader.setUrgent(
      [...this.views.values()].some((view) => needsDetailsNow(view.spec)),
    );
    this.detailsReader.start();
  }

  /**
   * Opens a view of what `spec` asks for, as the catalog has it now, never waiting for the disk.
   * Its folders are read while it is shown, and it gets a new version as their rows arrive. A
   * folder that cannot be read, or is not inside the library, is reported in its state once read.
   */
  async open(spec: ViewSpec): Promise<ViewState> {
    requireViewSpec(spec);
    for (const viewId of this.views.keys()) {
      if (this.views.size < MAX_VIEWS) {
        break;
      }
      await this.close(viewId);
    }
    const viewId = randomUUID();
    const view = {
      spec,
      version: { count: 0, unread: 0, unsupported: 0, version: 0 },
      viewId,
    } as OpenView;
    this.readFolders(view);
    try {
      view.version = await this.sources.catalog.call('openView', viewId, spec);
    } catch (error) {
      // Never opened, so nothing will close it to stop the read it joined.
      this.stopUnusedRead(view);
      throw error;
    }
    this.views.set(viewId, view);
    this.updateDetailsUrgency();
    return viewStateOf(view);
  }

  private requireOpen(viewId: unknown): OpenView {
    requireString(viewId);
    const view = this.views.get(viewId);
    if (!view) {
      throw new Error('The view is closed.');
    }
    return view;
  }

  rows(viewId: string, version: number, start: number, count: number) {
    requireViewRange(version, start, count);
    this.requireOpen(viewId);
    return this.sources.catalog.call('viewRows', viewId, version, start, count);
  }

  indexOf(viewId: string, version: number, entryId: string): Promise<number | null> {
    requireViewRange(version, 0, 0);
    requireString(entryId);
    this.requireOpen(viewId);
    return this.sources.catalog.call('viewIndexOf', viewId, version, entryId);
  }

  async facets(viewId: string): Promise<ViewFacets> {
    this.requireOpen(viewId);
    const facets = await this.sources.catalog.call('viewFacets', viewId);
    if (!facets) {
      throw new Error('The view is closed.');
    }
    return facets;
  }

  /** What the view shows. */
  specOf(viewId: string): ViewSpec {
    return this.requireOpen(viewId).spec;
  }

  /** What the view's folders held that could not be read, as far as its read has got. */
  errors(viewId: string): ReadError[] {
    return this.requireOpen(viewId).run.errors;
  }

  async close(viewId: string): Promise<void> {
    requireString(viewId);
    const view = this.views.get(viewId);
    if (!view) {
      return;
    }
    this.views.delete(viewId);
    this.stopUnusedRead(view);
    this.updateDetailsUrgency();
    await this.sources.catalog.call('closeView', viewId);
  }

  /** Stops the read of the view's scope once no other view of it is open. */
  private stopUnusedRead(view: OpenView) {
    const key = scopeKey(view.spec);
    const shared = this.runs.get(key);
    shared?.views.delete(view.viewId);
    if (shared?.views.size === 0) {
      shared.controller.abort();
      this.runs.delete(key);
    }
  }

  /**
   * Starts forgetting the details of every photo in the catalog, so each is read again. The
   * library's own catalog writer does it a batch at a time, and the open views update as each
   * batch is written.
   */
  forgetDetails(): Promise<void> {
    return this.sources.catalog.call('forgetDetails');
  }

  /** Wakes the details reader, because a change on disk may have added photos to read. */
  wakeDetailsReader(): void {
    this.detailsReader.wake();
  }

  /**
   * Marks folders to be read again because they changed. Without folders, every open view reads
   * all of its folders again, and the catalog shows them meanwhile.
   */
  forget(folderIds?: string[]): void {
    this.sources.indexer.forget(folderIds);
    if (folderIds) {
      return;
    }
    const started = new Set<string>();
    for (const view of this.views.values()) {
      const key = scopeKey(view.spec);
      this.readFolders(view, !started.has(key));
      started.add(key);
      this.sendState(view);
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
