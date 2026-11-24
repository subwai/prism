import type { GalleryView } from '#data/views/gallery-view';
import { useViewEntries, useViewIndex, useViewState } from '#hooks/use-view';
import type { PhotoEntry } from '@prism/shared';
import { useRef } from 'react';

/** Where the photo a viewer shows is among those it browses, and how to step to another. */
export interface Browsing {
  index: number;
  count: number;
  /**
   * Steps `offset` entries along, round to the start past the end if `wrap`. A viewer that
   * shows a single photo has none.
   */
  step?: (offset: number, wrap?: boolean) => void;
}

/** Browsing `view` from `selected`, choosing entries with `onSelect` as it steps. */
export function useBrowsing(
  view: GalleryView,
  selected: PhotoEntry | null,
  onSelect: (entry: PhotoEntry) => void,
): Browsing {
  const index = useViewIndex(view, selected?.id ?? null);
  const { count } = useViewState(view);
  // The entries either side are read ahead, so stepping to them shows them at once.
  useViewEntries(view, index - 1, index + 2);
  // Where the last step went from `index`. A step that comes before that one shows, as the arrow
  // keys can in a busy window, goes on from there rather than from what is still on screen.
  const last = useRef<{ from: number; to: number } | null>(null);
  return {
    count,
    index,
    step(offset, wrap = false) {
      const from = last.current?.from === index ? last.current.to : index;
      const next = wrap ? (((from + offset) % count) + count) % count : from + offset;
      if (next < 0 || next >= count) {
        return;
      }
      const step = { from: index, to: next };
      last.current = step;
      view
        .entry(next)
        .then((entry) => {
          // Only the latest step selects, should an earlier one's entry take longer to read.
          if (entry && last.current === step) {
            view.rememberIndex(entry.id, next);
            onSelect(entry);
          }
        })
        .catch(() => null);
    },
  };
}
