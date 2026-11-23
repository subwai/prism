import type { Virtualizer } from '@tanstack/react-virtual';

// A virtualizer, here TanStack Virtual's, mounts only the rows near the screen, so a long list
// stays light.

/**
 * The longest a list's scroller may get. Chromium stops an element growing at 16,777,216 px,
 * past which the rest of a longer list could not be scrolled to, so this stays clear of it.
 */
export const MAX_SCROLL_SIZE = 15_000_000;

/**
 * How a list `total` pixels long, seen through a `viewport`, scrolls in a scroller no longer
 * than `max`: the `size` of the scroller's content, and how an offset into the scroller maps
 * `toFull`, into the whole list, and back `toShown`. Offsets map in proportion, so both ends
 * meet exactly and dragging the scrollbar reaches every row. A list that fits keeps its
 * offsets as they are.
 *
 * Our own, since TanStack Virtual has no answer for the cap (TanStack/virtual#616). This is
 * the usual one, which react-virtualized takes too; a scrolled pixel moves a list over the cap
 * by more than a pixel, in proportion to how far over it is.
 */
export function cappedScroll(total: number, viewport: number, max = MAX_SCROLL_SIZE) {
  const size = Math.min(total, max);
  const fullEnd = total - viewport;
  const shownEnd = size - viewport;
  return {
    size,
    toFull: (offset: number) => mapOffset(offset, shownEnd, fullEnd),
    toShown: (offset: number) => mapOffset(offset, fullEnd, shownEnd),
  };
}

/** Where `offset`, of a scroller that ends at `from`, falls in one that ends at `to`. */
function mapOffset(offset: number, from: number, to: number) {
  if (from === to) {
    return offset;
  }
  if (offset <= 0) {
    return 0;
  }
  return offset >= from ? to : (offset / from) * to;
}

/** What a wheel event says of how far to scroll, as a `WheelEvent` has it. */
export type Wheel = Pick<WheelEvent, 'deltaMode' | 'deltaX' | 'deltaY'>;

// `WheelEvent.DOM_DELTA_LINE` and `DOM_DELTA_PAGE`, which tests without a browser lack.
const DELTA_LINE = 1;
const DELTA_PAGE = 2;
/** How far a line of a wheel that scrolls in lines goes, as far as Chromium scrolls one. */
const LINE_SIZE = 40;

/**
 * How many pixels `wheel` scrolls a list that runs across, when `horizontal`, or down, through
 * a `viewport` that long. Only the wheel's distance along the list counts, as when the browser
 * scrolls it: a filmstrip moves sideways, not with a wheel turned down.
 */
export function wheelDistance(wheel: Wheel, horizontal: boolean, viewport: number) {
  const delta = horizontal ? wheel.deltaX : wheel.deltaY;
  if (wheel.deltaMode === DELTA_LINE) {
    return delta * LINE_SIZE;
  }
  return wheel.deltaMode === DELTA_PAGE ? delta * viewport : delta;
}

// Keep in sync with the filmstrip's px-1.5, which the grid has across, not down.
const STRIP_PADDING = 12;

export type ListVirtualizer = Virtualizer<HTMLElement, Element>;

/**
 * How `virtualizer`'s list scrolls in a scroller no longer than the cap (see `cappedScroll`).
 * It keeps to offsets into the whole list, which these map to and from the scroller's.
 */
export function scrollOf(virtualizer: ListVirtualizer) {
  const { horizontal } = virtualizer.options;
  // The virtualizer's viewport takes in the scroller's padding, which its content does not.
  const viewport =
    (virtualizer.scrollRect?.[horizontal ? 'width' : 'height'] ?? 0) -
    (horizontal ? STRIP_PADDING : 0);
  return { ...cappedScroll(virtualizer.getTotalSize(), viewport), viewport };
}
