import { type GalleryView, pagesOf, VIEW_PAGE } from '#data/gallery-view';
import type { PhotoEntry, ViewState } from '@prism/shared';
import { useQueries, useQuery } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';

/** The view's state as the worker last told it: how many entries, and whether it is reading. */
export function useViewState(view: GalleryView): ViewState {
  return useSyncExternalStore(view.subscribe, view.getSnapshot);
}

function stopIgnoring() {
  // Nothing was subscribed to.
}

/** Subscribes to nothing, for a view not open yet. */
function ignoreChanges() {
  return stopIgnoring;
}

/** The version of `view` the worker last told of, for a view that may not be open yet. */
export function useViewVersion(view: GalleryView | null): number {
  return useSyncExternalStore(
    view?.subscribe ?? ignoreChanges,
    () => view?.getSnapshot().version ?? 0,
  );
}

/**
 * The view's entries from `start` up to `end`, as far as they have been read: the pages they
 * are on are read while this shows them. An entry not read yet is `undefined`; one read at an
 * older version shows until its page is read again.
 */
export function useViewEntries(
  view: GalleryView,
  start: number,
  end: number,
): (index: number) => PhotoEntry | undefined {
  const { count, version } = useViewState(view);
  const pages = pagesOf(start, Math.min(end, count));
  const results = useQueries({ queries: pages.map((page) => view.pageQuery(page, version)) });
  const first = pages[0] ?? 0;
  return (index) => results[Math.floor(index / VIEW_PAGE) - first]?.data?.rows[index % VIEW_PAGE];
}

/**
 * Where `entryId` is in the view, or -1 while that is not known or it is not there. As the
 * view changes, the place it had shows until its new one is known.
 */
export function useViewIndex(view: GalleryView, entryId: string | null): number {
  return useViewPlace(view, entryId).index;
}

/** Where `entryId` is, as `useViewIndex` has it, and whether the view is known not to have it. */
function useViewPlace(view: GalleryView, entryId: string | null) {
  const { version } = useViewState(view);
  const { data, isPlaceholderData } = useQuery({
    ...view.indexQuery(entryId, version),
    placeholderData: (previous, query) => (query?.queryKey[4] === entryId ? previous : undefined),
  });
  const index = entryId === null ? -1 : (data ?? -1);
  return { index, missing: entryId !== null && data === -1 && !isPlaceholderData };
}

/**
 * The entry `entryId` in the view, and where it is: `undefined` until both are known. It is
 * `missing` once the view, as of its latest version, is known not to have it.
 */
export function useViewEntry(view: GalleryView, entryId: string | null) {
  const { index, missing } = useViewPlace(view, entryId);
  const at = useViewEntries(view, index, index + 1);
  return { entry: index === -1 ? undefined : at(index), index, missing };
}

/** Where the photo a viewer shows is among those it browses, and how to step to another. */
export interface Browsing {
  index: number;
  count: number;
  /** Steps `offset` entries along, round to the start past the end if `wrap`. */
  step?: (offset: number, wrap?: boolean) => void;
}

/** Browsing `view` from `selected`, choosing entries with `onSelect` as it steps. */
export function useBrowsing(
  view: GalleryView,
  selected: PhotoEntry | null,
  onSelect?: (entry: PhotoEntry) => void,
): Browsing {
  const index = useViewIndex(view, selected?.id ?? null);
  const { count } = useViewState(view);
  // The entries either side are read ahead, so stepping to them shows them at once.
  useViewEntries(view, index - 1, index + 2);
  if (!onSelect) {
    return { count, index };
  }
  return {
    count,
    index,
    step(offset, wrap = false) {
      const next = wrap ? (((index + offset) % count) + count) % count : index + offset;
      if (next < 0 || next >= count) {
        return;
      }
      view
        .entry(next)
        .then((entry) => {
          if (entry) {
            view.know(entry.id, next);
            onSelect(entry);
          }
        })
        .catch(() => null);
    },
  };
}
