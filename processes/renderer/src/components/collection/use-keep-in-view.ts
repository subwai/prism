import { type ListVirtualizer, scrollOf } from '#components/collection/capped-scroll';
import { useCallback, useLayoutEffect, useRef } from 'react';

// A virtualizer, here TanStack Virtual's, mounts only the rows near the screen, so a long list
// stays light.

/** How far a strip is scrolled: held at one end, or with its left edge this many cards in. */
type Scrolled = 'start' | 'end' | number;

function scrolledOf(scroller: HTMLElement, strip: ListVirtualizer, cardSize: number): Scrolled {
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
export function useKeepInView(strip: ListVirtualizer | null, cardSize: number) {
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
