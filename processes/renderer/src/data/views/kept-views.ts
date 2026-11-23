import { GalleryView, type ViewOwner } from '#data/views/gallery-view';
import type { PhotosAPI, ViewSpec, ViewState } from '@prism/shared';
import type { QueryClient } from '@tanstack/react-query';
import { LRUCache } from 'lru-cache';

// Views kept open, most recently used last: enough to go back and forth between a few
// folders, and between grid and filmstrip, and to clear a search typed a letter at a time.
const KEPT_VIEWS = 6;

/**
 * The views a window has open in the worker, by what they show, so going back to one shows it
 * again as it is. Past a few, the one used longest ago is closed. The library passes them their
 * new versions.
 */
export class KeptViews {
  /**
   * Reading one counts as using it. One dropped, past `KEPT_VIEWS` or because it is replaced or
   * cleared, is closed.
   */
  private readonly views = new LRUCache<string, Promise<GalleryView>>({
    dispose: (view) => {
      view.then((closed) => this.close(closed)).catch(() => null);
    },
    max: KEPT_VIEWS,
  });
  private readonly opened = new Map<string, GalleryView>();
  private readonly byId = new Map<string, GalleryView>();

  constructor(
    private readonly api: PhotosAPI,
    private readonly queries: QueryClient,
    private readonly owner: ViewOwner,
  ) {}

  /** Takes the views' new states from the worker, such as their new versions. */
  update(states: ViewState[]): void {
    for (const state of states) {
      this.byId.get(state.viewId)?.update(state);
    }
  }

  /** The view of `spec`, kept or opened. One that could not read its folder is opened again. */
  view(spec: ViewSpec): Promise<GalleryView> {
    const key = JSON.stringify(spec);
    const kept = this.views.get(key);
    if (kept && !this.opened.get(key)?.getSnapshot().error) {
      return kept;
    }
    const opening = this.api.openView(spec).then((state) => {
      const view = new GalleryView(this.api, this.queries, spec, state, this.owner);
      this.byId.set(view.viewId, view);
      this.opened.set(key, view);
      return view;
    });
    opening.catch(() => {
      // Only if it is still the one kept: after `clear`, a newer one may have taken its place.
      if (this.views.peek(key) === opening) {
        this.views.delete(key);
      }
    });
    // Replaces, and so closes, a kept one that could not read its folder.
    this.views.set(key, opening);
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
    this.views.clear();
  }
}
