import { useVirtualizer } from '@tanstack/react-virtual';
import { type RefObject, useCallback, useEffect, useState } from 'react';

// Keep in sync with the collection's row gap-3 and px-2, and its grid caption's h-6.
export const GAP = 12;
const ROW_PADDING = 16,
  CAPTION_HEIGHT = 24;

/**
 * Lays `count` entries out in rows of as many `size`-pixel cards as fit the width, or, when
 * `horizontal`, in one row of cards that scrolls sideways, rendering only the rows on screen.
 * `measure` goes on the sizer inside the `scroller`.
 */
export function useGridLayout(
  count: number,
  size: number,
  horizontal: boolean,
  scroller: RefObject<HTMLElement | null>
) {
  const [width, setWidth] = useState(0);
  const columns = horizontal
    ? 1
    : Math.max(1, Math.floor((width - ROW_PADDING + GAP) / (size + GAP)));
  // Cards stretch to fill the row, so square thumbnails are as tall as a card is wide.
  const cardWidth = horizontal ? size : (width - ROW_PADDING - GAP * (columns - 1)) / columns;
  const rowSize = Math.max(0, cardWidth) + GAP + (horizontal ? 0 : CAPTION_HEIGHT);
  const virtualizer = useVirtualizer({
    count: Math.ceil(count / columns),
    estimateSize: () => rowSize,
    getScrollElement: () => scroller.current,
    horizontal,
    overscan: 2,
    // The toolbar already names the folder, so the grid starts just below it.
    paddingEnd: horizontal ? 0 : 16,
    paddingStart: horizontal ? 0 : 16,
    scrollPaddingStart: horizontal ? 0 : 16
  });
  // Measured while committing, so the first frame (and a crossfade's snapshot of it) already
  // has its columns; waiting for the observer would paint one frame at zero width. The sizer
  // spans the scroller's content box.
  const measure = useCallback((node: HTMLDivElement) => {
    setWidth(node.clientWidth);
    const observer = new ResizeObserver(([entry]) => setWidth(entry?.contentRect.width ?? 0));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  // Rows already laid out keep their old size until the virtualizer forgets it.
  useEffect(() => {
    virtualizer.measure();
  }, [virtualizer, rowSize, columns]);
  return { columns, measure, rowSize, virtualizer };
}
