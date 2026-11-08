import { createGalleryView, type GalleryView, type ViewOwner } from '#data/gallery-view';
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
export interface KeptViews {
  /** The view of `spec`, kept or opened. One that could not read its folder is opened again. */
  view: (spec: ViewSpec) => Promise<GalleryView>;
  /** Closes every view, so the next ones read their folders again. */
  clear: () => void;
  /** Closes every view and stops hearing of them, as the session ends. */
  stop: () => void;
}

export function createKeptViews(api: PhotosAPI, queries: QueryClient, owner: ViewOwner): KeptViews {
  /** Most recently used last. */
  const views = new Map<string, Promise<GalleryView>>();
  const opened = new Map<string, GalleryView>();
  const byId = new Map<string, GalleryView>();
  const stopListening = api.onView((state) => byId.get(state.viewId)?.update(state));

  function close(view: GalleryView) {
    byId.delete(view.viewId);
    const key = JSON.stringify(view.spec);
    if (opened.get(key) === view) {
      opened.delete(key);
    }
    view.close();
  }

  function closeLater(view: Promise<GalleryView>) {
    view.then(close).catch(() => null);
  }

  function clear() {
    for (const view of views.values()) {
      closeLater(view);
    }
    views.clear();
  }

  return {
    clear,
    stop() {
      clear();
      stopListening();
    },
    view(spec) {
      const key = JSON.stringify(spec);
      const kept = views.get(key);
      views.delete(key);
      if (kept && !opened.get(key)?.getSnapshot().error) {
        views.set(key, kept);
        return kept;
      }
      if (kept) {
        closeLater(kept);
      }
      const opening = api.openView(spec).then((state) => {
        const view = createGalleryView(api, queries, spec, state, owner);
        byId.set(view.viewId, view);
        opened.set(key, view);
        return view;
      });
      opening.catch(() => views.delete(key));
      views.set(key, opening);
      for (const [oldest, view] of views) {
        if (views.size <= KEPT_VIEWS) {
          break;
        }
        views.delete(oldest);
        closeLater(view);
      }
      return opening;
    },
  };
}
