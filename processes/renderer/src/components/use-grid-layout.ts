import { useVirtualizer, type Virtualizer } from '@tanstack/react-virtual';
import { type RefObject, useCallback, useLayoutEffect, useRef, useState } from 'react';

// Keep in sync with the collection's row gap-3 and px-2.
export const GAP = 12;
const ROW_PADDING = 16;

/**
 * Lays `count` entries out in rows of as many `size`-pixel cards as fit the width, or, when
 * `horizontal`, in one row of cards that scrolls sideways, rendering only the rows on screen.
 * `measure` goes on the sizer inside the `scroller`, and `anchor` on the scroller itself.
 */
export function useGridLayout(
  count: number,
  size: number,
  horizontal: boolean,
  scroller: RefObject<HTMLElement | null>,
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
    overscan: 2,
    // The toolbar already names the folder, so the grid starts just below it.
    paddingEnd: horizontal ? 0 : 16,
    paddingStart: horizontal ? 0 : 16,
    scrollPaddingStart: horizontal ? 0 : 16,
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
  const anchor = useKeepInView(horizontal ? virtualizer : null, rowSize);
  return { anchor, columns, measure, rowSize, virtualizer };
}

/** How far a strip is scrolled: held at one end, or with its left edge this many cards in. */
type Scrolled = 'start' | 'end' | number;

function scrolledOf(scroller: HTMLElement, cardSize: number): Scrolled {
  const end = scroller.scrollWidth - scroller.clientWidth;
  if (scroller.scrollLeft <= 1) {
    return 'start';
  }
  return scroller.scrollLeft >= end - 1 ? 'end' : scroller.scrollLeft / cardSize;
}

/** The scroll offset that keeps a strip scrolled `at` in cards of `size` pixels as they become `cardSize`. */
function offsetFor(scroller: HTMLElement, at: Scrolled, size: number, cardSize: number) {
  const view = scroller.clientWidth;
  if (at === 'start') {
    return 0;
  }
  if (at === 'end') {
    return scroller.scrollWidth - view;
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
function useKeepInView(strip: Virtualizer<HTMLElement, Element> | null, cardSize: number) {
  // Kept in pixels and cards, not read back from the scroller, so dragging the size back and
  // forth does not drift with its rounding.
  const kept = useRef<{ at: Scrolled; size: number; written: number | null }>({
    at: 'start',
    size: cardSize,
    written: null,
  });
  const scroller = useRef<HTMLElement | null>(null);
  const anchor = useCallback((node: HTMLElement) => {
    scroller.current = node;
    const scrolled = () => {
      const { size, written } = kept.current;
      // Our own scroll, from the last change of size, is not where someone scrolled to.
      if (written !== null && Math.abs(node.scrollLeft - written) < 1) {
        return;
      }
      kept.current = { at: scrolledOf(node, size), size, written: null };
    };
    node.addEventListener('scroll', scrolled, { passive: true });
    return () => {
      node.removeEventListener('scroll', scrolled);
      scroller.current = null;
    };
  }, []);
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
      Math.abs(sizer.offsetWidth - strip.getTotalSize()) >= 1
    ) {
      return;
    }
    const target = offsetFor(node, at, size, cardSize);
    node.scrollLeft = target;
    const written = node.scrollLeft;
    // A middle too near either end to stay in the middle leaves the strip at that end.
    const clamped = Math.abs(written - target) >= 1;
    kept.current = {
      at: typeof at === 'number' && !clamped ? target / cardSize : scrolledOf(node, cardSize),
      size: cardSize,
      written,
    };
  });
  return anchor;
}
