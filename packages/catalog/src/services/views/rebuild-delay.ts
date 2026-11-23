import { needsDetails, type ViewSpec } from '@prism/shared';

// A view is made again at most this often while the catalog changes under it, or twice as
// long as making it took, whichever is longer, so a large one leaves time to make the others.
const MIN_REFRESH_MS = 500;

// While only photos' details come in, a view waits eight times as long as making it took
// instead, which keeps making it to about a ninth of a core: a view of 1.8 million photos takes
// about 0.6 s, so it is made every 5 s or so, while a small one still keeps up at once. Never
// less often than every 30 s, so the slowest still catch up.
const DETAILS_REFRESH_FACTOR = 8;
const MAX_DETAILS_REFRESH_MS = 30_000;

/**
 * Whether photos' details can change what the view shows or its order: a sort by date taken,
 * filters by what photos' files say, and a search, which matches their tags. Details reach
 * every other view only as its count of photos still to read, and as its rows.
 */
export function readsDetails(spec: Pick<ViewSpec, 'sort' | 'filter' | 'search'>): boolean {
  return needsDetails(spec) || spec.search.trim() !== '';
}

/**
 * How long after a view was made, which took `took`, it is made again: soon after a change of
 * the catalog's rows, which the window waits to show, but later the longer it takes when only
 * photos' details came in, as they do all the time while they are read in the background.
 */
export function rebuildDelay(took: number, onlyDetails: boolean): number {
  if (!onlyDetails) {
    return Math.max(MIN_REFRESH_MS, took * 2);
  }
  return Math.min(MAX_DETAILS_REFRESH_MS, Math.max(MIN_REFRESH_MS, took * DETAILS_REFRESH_FACTOR));
}
