import { GalleryView, type ViewOwner } from '#data/gallery-view';
import type { PhotosAPI, ViewSpec } from '@prism/shared';
import type { QueryClient } from '@tanstack/react-query';

// Views kept open, most recently used last: enough to go back and forth between a few
// folders, and between grid and filmstrip, and to clear a search typed a letter at a time.
const KEPT_VIEWS = 6;

/**
 * The views a window has open in the worker, by what they show, so going back to one shows it
 * again as it is. Past a few, the one used longest ago is closed. Each hears of its new
 * versions from the worker.
 */
export class KeptViews {
  /** Most recently used last. */
  private readonly views = new Map<string, Promise<GalleryView>>();
  private readonly opened = new Map<string, GalleryView>();
  private readonly byId = new Map<string, GalleryView>();
  private readonly stopListening: () => void;

  constructor(
    private readonly api: PhotosAPI,
    private readonly queries: QueryClient,
    private readonly owner: ViewOwner,
  ) {
    this.stopListening = api.onView((state) => this.byId.get(state.viewId)?.update(state));
  }

  /** The view of `spec`, kept or opened. One that could not read its folder is opened again. */
  view(spec: ViewSpec): Promise<GalleryView> {
    const key = JSON.stringify(spec);
    const kept = this.views.get(key);
    this.views.delete(key);
    if (kept && !this.opened.get(key)?.getSnapshot().error) {
      this.views.set(key, kept);
      return kept;
    }
    kept?.then((view) => this.close(view)).catch(() => null);
    const opening = this.api.openView(spec).then((state) => {
      const view = new GalleryView(this.api, this.queries, spec, state, this.owner);
      this.byId.set(view.viewId, view);
      this.opened.set(key, view);
      return view;
    });
    opening.catch(() => this.views.delete(key));
    this.views.set(key, opening);
    for (const [oldest, view] of this.views) {
      if (this.views.size <= KEPT_VIEWS) {
        break;
      }
      this.views.delete(oldest);
      view.then((closed) => this.close(closed)).catch(() => null);
    }
    return opening;
  }

  private close(view: GalleryView) {
    this.byId.delete(view.viewId);
    const key = JSON.stringify(view.spec);
    if (this.opened.get(key) === view) {
      this.opened.delete(key);
    }
    view.close();
  }

  /** Closes every view, so the next ones read their folders again. */
  clear(): void {
    for (const view of this.views.values()) {
      view.then((closed) => this.close(closed)).catch(() => null);
    }
    this.views.clear();
  }

  /** Closes every view and stops hearing of them, as the session ends. */
  stop(): void {
    this.clear();
    this.stopListening();
  }
}
