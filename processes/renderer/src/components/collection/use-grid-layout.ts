import { scrollOf, wheelDistance } from '#components/collection/capped-scroll';
import { useKeepInView } from '#components/collection/use-keep-in-view';
import { elementScroll, observeElementOffset, useVirtualizer } from '@tanstack/react-virtual';
import { type RefObject, useCallback, useLayoutEffect, useRef, useState } from 'react';

// Keep in sync with the collection's row gap-3 and px-2.
export const GAP = 12;
const ROW_PADDING = 16;

interface GridLayoutOptions {
  /** How many entries the list holds. */
  count: number;
  /** How wide a card is, in pixels; in the grid, cards stretch to fill the row. */
  size: number;
  /** One row of cards that scrolls sideways, as the filmstrip has, rather than a grid. */
  horizontal: boolean;
  /** The element that scrolls. */
  scroller: RefObject<HTMLElement | null>;
  /**
   * Called with the entries on screen, from `start` up to `end`, each time they change. It
   * leaves out the rows rendered past either edge.
   */
  onRowsOnScreen: (start: number, end: number) => void;
}

/**
 * Lays entries out in rows of as many cards as fit the width, or in one row that scrolls
 * sideways, rendering only the rows on screen. `measure` goes on the sizer inside the
 * scroller, and `anchor` and `wheel` on the scroller itself.
 */
export function useGridLayout({
  count,
  size,
  horizontal,
  scroller,
  onRowsOnScreen,
}: GridLayoutOptions) {
  const [width, setWidth] = useState(0);
  const columns = horizontal
    ? 1
    : Math.max(1, Math.floor((width - ROW_PADDING + GAP) / (size + GAP)));
  // Cards stretch to fill the row, so square thumbnails are as tall as a card is wide.
  const cardWidth = horizontal ? size : (width - ROW_PADDING - GAP * (columns - 1)) / columns;
  const rowSize = Math.max(0, cardWidth) + GAP;
  // Where a wheel last scrolled a list over the cap, in the whole list and in the scroller, and
  // the function that passes a new offset to the virtualizer.
  const wheeled = useRef<{ full: number; shown: number } | null>(null);
  const reportOffset = useRef<((offset: number) => void) | null>(null);
  const virtualizer = useVirtualizer({
    count: Math.ceil(count / columns),
    estimateSize: () => rowSize,
    getScrollElement: () => scroller.current,
    horizontal,
    observeElementOffset: (instance, onOffset) => {
      reportOffset.current = (offset) => onOffset(offset, true);
      return observeElementOffset(instance, (offset, isScrolling) => {
        // The scroller keeps whole pixels, each several of a list over the cap, so while it
        // stays on the pixel a wheel left it at, the list stays where the wheel put it.
        const scroll = scrollOf(instance);
        const wheel = wheeled.current;
        const kept = wheel && scroll.size < instance.getTotalSize() && wheel.shown === offset;
        onOffset(kept ? wheel.full : scroll.toFull(offset), isScrolling);
      });
    },
    onChange: ({ range }) => {
      if (range) {
        onRowsOnScreen(range.startIndex * columns, Math.min(count, (range.endIndex + 1) * columns));
      }
    },
    overscan: 2,
    // The toolbar already names the folder, so the grid starts just below it.
    paddingEnd: horizontal ? 0 : 16,
    paddingStart: horizontal ? 0 : 16,
    scrollPaddingStart: horizontal ? 0 : 16,
    scrollToFn: (offset, { adjustments = 0, behavior }, instance) =>
      elementScroll(scrollOf(instance).toShown(offset + adjustments), { behavior }, instance),
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
  // Rows already laid out keep their old size until the virtualizer forgets it. Forgotten
  // before painting, so no frame shows cards of the new size at the old places.
  useLayoutEffect(() => {
    virtualizer.measure();
  }, [virtualizer, rowSize, columns]);
  // A capped scroller holds the list in proportion, so the list would move under it as it
  // grows or shrinks. Kept at the same offset into the whole list instead, as a list that fits
  // is. After every commit, since the list takes its new size only once it is measured above,
  // and before the strip below keeps its middle card where it was.
  const sized = useRef(0);
  useLayoutEffect(() => {
    const node = scroller.current;
    const scroll = scrollOf(virtualizer);
    const total = virtualizer.getTotalSize();
    if (node && total !== sized.current && scroll.size !== total) {
      node.scrollTo({
        [horizontal ? 'left' : 'top']: scroll.toShown(virtualizer.scrollOffset ?? 0),
      });
    }
    sized.current = total;
  });
  const anchor = useKeepInView(horizontal ? virtualizer : null, rowSize);
  /**
   * Scrolls a list over the cap by as many of its own pixels as the wheel or trackpad asks
   * for, as a list that fits is, where the browser would scroll the capped scroller by that
   * many and so the list by many more. Our own, since neither the browser nor TanStack Virtual
   * can scale a wheel: the virtualizer's `scrollBy` writes to the scroller, which loses every
   * move of less than one of its pixels. A list that fits is left to the browser.
   */
  const wheel = useCallback(
    (node: HTMLElement) => {
      const handleWheel = (event: WheelEvent) => {
        const scroll = scrollOf(virtualizer);
        const total = virtualizer.getTotalSize();
        const distance = wheelDistance(event, horizontal, scroll.viewport);
        // Ctrl held is a pinch, not a scroll.
        if (scroll.size === total || event.ctrlKey || distance === 0) {
          return;
        }
        event.preventDefault();
        const from = virtualizer.scrollOffset ?? 0;
        const to = Math.min(Math.max(0, from + distance), total - scroll.viewport);
        node.scrollTo({ [horizontal ? 'left' : 'top']: scroll.toShown(to) });
        wheeled.current = { full: to, shown: horizontal ? node.scrollLeft : node.scrollTop };
        // Passed on at once, since a move too small to change the scroller's pixel scrolls nothing.
        reportOffset.current?.(to);
      };
      node.addEventListener('wheel', handleWheel, { passive: false });
      return () => node.removeEventListener('wheel', handleWheel);
    },
    [virtualizer, horizontal],
  );
  /**
   * Scrolls `row` into view, if it is not already, as the virtualizer's `scrollToIndex` does
   * with `align: 'auto'`. That stops at the end of a capped scroller, short of the rows past
   * it, so a list over the cap is scrolled here instead.
   */
  const scrollToRow = useCallback(
    (row: number) => {
      const scroll = scrollOf(virtualizer);
      const item = virtualizer.measurementsCache[row];
      const node = scroller.current;
      if (scroll.size === virtualizer.getTotalSize() || !item || !node) {
        virtualizer.scrollToIndex(row, { align: 'auto' });
        return;
      }
      const { count: rows, paddingEnd, scrollPaddingStart } = virtualizer.options;
      const offset = virtualizer.scrollOffset ?? 0;
      const { viewport } = scroll;
      // The last row shows the padding after it too.
      const end = row === rows - 1 ? item.end + paddingEnd : item.end;
      // Rounded so the whole row is in view, as the scroller keeps whole pixels.
      const side = horizontal ? 'left' : 'top';
      if (end > offset + viewport) {
        node.scrollTo({ [side]: Math.ceil(scroll.toShown(end - viewport)) });
      } else if (item.start - scrollPaddingStart < offset) {
        node.scrollTo({ [side]: Math.floor(scroll.toShown(item.start - scrollPaddingStart)) });
      }
    },
    [virtualizer, scroller, horizontal],
  );
  const scroll = scrollOf(virtualizer);
  const offset = virtualizer.scrollOffset ?? 0;
  return {
    anchor,
    columns,
    measure,
    rowSize,
    scrollToRow,
    // Rows sit at their place in the whole list, less how far a capped scroller is short of it.
    shift: offset - scroll.toShown(offset),
    size: scroll.size,
    virtualizer,
    wheel,
  };
}
