/** Where the reader is, and which way a page turn goes. */
interface PageTurn {
  /** 1 for the next page, -1 for the one before. */
  direction: 1 | -1;
  /** The page an earlier turn is still scrolling to, or null when no turn is under way. */
  turningTo: number | null;
  /** The page at the top of the reader, with where its top edge is, if any page is there. */
  pageAtTop: { index: number; start: number } | undefined;
  /** How far the reader is scrolled, in pixels. */
  scrollOffset: number;
  /** How many pages there are. */
  count: number;
}

/**
 * The page a turn goes to. A turn pressed while the last one still scrolls goes one further, so
 * quick presses each turn a page. Turning back from partway down a page goes to its top first,
 * as turning back to it would. The turn stops at the first and last pages.
 */
export function pageToTurnTo({ direction, turningTo, pageAtTop, scrollOffset, count }: PageTurn) {
  let from = turningTo ?? pageAtTop?.index ?? 0;
  const partway = pageAtTop !== undefined && pageAtTop.start < scrollOffset - 1;
  if (turningTo === null && direction < 0 && partway) {
    from += 1;
  }
  return Math.max(0, Math.min(count - 1, from + direction));
}
