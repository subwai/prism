/**
 * In a view of fewer rows than this, thumbnails are made ahead for every row, nearest to what is
 * on screen first. In a larger view, only folders' covers within half this many rows of the
 * screen are made ahead.
 */
export const AHEAD_ROWS = 1000;

/**
 * The rows of a view of `count` rows in the order to make their thumbnails: the rows on screen,
 * from `start` up to `end`, then outward from them. The row after comes before the row before,
 * as most scrolling goes down the view.
 */
export function nearestFirst(count: number, start: number, end: number): number[] {
  const first = Math.min(Math.max(0, start), count);
  const last = Math.min(Math.max(first, end), count);
  const order: number[] = [];
  for (let index = first; index < last; index += 1) {
    order.push(index);
  }
  for (let after = last, before = first - 1; after < count || before >= 0; after += 1) {
    if (after < count) {
      order.push(after);
    }
    if (before >= 0) {
      order.push(before);
      before -= 1;
    }
  }
  return order;
}
