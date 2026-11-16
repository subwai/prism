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
