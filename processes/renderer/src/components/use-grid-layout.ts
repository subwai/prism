import { cappedScroll } from '#components/capped-scroll';
import {
  elementScroll,
  observeElementOffset,
  useVirtualizer,
  type Virtualizer,
} from '@tanstack/react-virtual';
import { type RefObject, useCallback, useLayoutEffect, useRef, useState } from 'react';

// Keep in sync with the collection's row gap-3 and px-2.
export const GAP = 12;
const ROW_PADDING = 16;
// Keep in sync with the filmstrip's px-1.5, which the grid has across, not down.
const STRIP_PADDING = 12;

type Rows = Virtualizer<HTMLElement, Element>;

/**
 * How `virtualizer`'s list scrolls in a scroller no longer than the cap (see `cappedScroll`).
 * It keeps to offsets into the whole list, which these map to and from the scroller's.
 */
function scrollOf(virtualizer: Rows) {
  const { horizontal } = virtualizer.options;
  // The virtualizer's viewport takes in the scroller's padding, which its content does not.
  const viewport =
    (virtualizer.scrollRect?.[horizontal ? 'width' : 'height'] ?? 0) -
    (horizontal ? STRIP_PADDING : 0);
  return { ...cappedScroll(virtualizer.getTotalSize(), viewport), viewport };
}

/**
 * Lays `count` entries out in rows of as many `size`-pixel cards as fit the width, or, when
 * `horizontal`, in one row of cards that scrolls sideways, rendering only the rows on screen.
 * `measure` goes on the sizer inside the `scroller`, and `anchor` on the scroller itself.
 * `onShown` hears which entries are on screen, from `start` up to `end`, without the rows
 * rendered past either edge, each time that changes.
 */
export function useGridLayout(
  count: number,
  size: number,
  horizontal: boolean,
  scroller: RefObject<HTMLElement | null>,
  onShown: (start: number, end: number) => void,
) {
  const [width, setWidth] = useState(0);
  const columns = horizontal
    ? 1
    : Math.max(1, Math.floor((width - ROW_PADDING + GAP) / (size + GAP)));
  // Cards stretch to fill the row, so square thumbnails are as tall as a card is wide.
  const cardWidth = horizontal ? size : (width - ROW_PADDING - GAP * (columns - 1)) / columns;
  const rowSize = Math.max(0, cardWidth) + GAP;
  const virtualizer = useVirtualizer({
    count: Math.ceil(count / columns),
    estimateSize: () => rowSize,
    getScrollElement: () => scroller.current,
    horizontal,
    observeElementOffset: (instance, onOffset) =>
      observeElementOffset(instance, (offset, isScrolling) =>
        onOffset(scrollOf(instance).toFull(offset), isScrolling),
      ),
    onChange: ({ range }) => {
      if (range) {
        onShown(range.startIndex * columns, Math.min(count, (range.endIndex + 1) * columns));
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
  };
}

/** How far a strip is scrolled: held at one end, or with its left edge this many cards in. */
type Scrolled = 'start' | 'end' | number;

function scrolledOf(scroller: HTMLElement, strip: Rows, cardSize: number): Scrolled {
  const end = scroller.scrollWidth - scroller.clientWidth;
  if (scroller.scrollLeft <= 1) {
    return 'start';
  }
  return scroller.scrollLeft >= end - 1
    ? 'end'
    : scrollOf(strip).toFull(scroller.scrollLeft) / cardSize;
}

/**
 * The offset into the whole list that keeps a strip scrolled `at` in cards of `size` pixels as
 * they become `cardSize`, or null to keep it at the end.
 */
function offsetFor(scroller: HTMLElement, at: Scrolled, size: number, cardSize: number) {
  const view = scroller.clientWidth;
  if (at === 'start') {
    return 0;
  }
  if (at === 'end') {
    return null;
  }
  return (at + view / 2 / size) * cardSize - view / 2;
}

/**
 * Keeps what a sideways `strip` shows in view as its cards change size, as when the
 * filmstrip is made taller: the card in the middle stays in the middle, and a strip scrolled
 * to either end stays there. Otherwise the strip keeps its scroll offset, which lands
 * somewhere else in the list at the new size. Neither the browser's scroll anchoring nor the
 * virtualizer's `anchorTo` follows cards that grow, only cards added or removed, so it is our
 * own. Returns the ref for the scroller.
 */
function useKeepInView(strip: Rows | null, cardSize: number) {
  // Kept in pixels and cards, not read back from the scroller, so dragging the size back and
  // forth does not drift with its rounding.
  const kept = useRef<{ at: Scrolled; size: number; written: number | null }>({
    at: 'start',
    size: cardSize,
    written: null,
  });
  const scroller = useRef<HTMLElement | null>(null);
  const anchor = useCallback(
    (node: HTMLElement) => {
      scroller.current = node;
      const scrolled = () => {
        const { size, written } = kept.current;
        // Our own scroll, from the last change of size, is not where someone scrolled to.
        if (!strip || (written !== null && Math.abs(node.scrollLeft - written) < 1)) {
          return;
        }
        kept.current = { at: scrolledOf(node, strip, size), size, written: null };
      };
      node.addEventListener('scroll', scrolled, { passive: true });
      return () => {
        node.removeEventListener('scroll', scrolled);
        scroller.current = null;
      };
    },
    [strip],
  );
  // After every commit, since the strip is only as wide as its cards at the new size one
  // render after the size changes, and scrolling before then would stop at the old width.
  useLayoutEffect(() => {
    const node = scroller.current;
    const sizer = node?.firstElementChild;
    const { at, size } = kept.current;
    if (
      !strip ||
      !node ||
      !(sizer instanceof HTMLElement) ||
      size === cardSize ||
      Math.abs(sizer.offsetWidth - scrollOf(strip).size) >= 1
    ) {
      return;
    }
    const target = offsetFor(node, at, size, cardSize);
    const shown =
      target === null ? node.scrollWidth - node.clientWidth : scrollOf(strip).toShown(target);
    node.scrollLeft = shown;
    const written = node.scrollLeft;
    // A middle too near either end to stay in the middle leaves the strip at that end.
    const clamped = Math.abs(written - shown) >= 1;
    kept.current = {
      at:
        typeof at === 'number' && target !== null && !clamped
          ? target / cardSize
          : scrolledOf(node, strip, cardSize),
      size: cardSize,
      written,
    };
  });
  return anchor;
}
