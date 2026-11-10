import type { ViewPage } from '#data/gallery-view';
import type { LibrarySession } from '#data/library';
import {
  type FolderListing,
  type FolderSummary,
  isRating,
  isRatingFilter,
  type PhotoEntry,
  type Rating,
} from '@prism/shared';
import type { QueryClient } from '@tanstack/react-query';

export { nextRating, RATINGS, type Rating } from '@prism/shared';

/** How many stars `stars` is, in words, as screen readers and menus say it. */
export function starsLabel(stars: number): string {
  return stars === 1 ? '1 star' : `${stars} stars`;
}

/**
 * What a rating filter's value lets through, as the search field shows it: `≥ 3 stars` for
 * `min3`, `≤ 2 stars` for `max2`. At the ends a range is one number of stars, or any.
 */
export function ratingFilterLabel(value: string): string {
  if (!isRatingFilter(value)) {
    return value;
  }
  if (value === 'unrated') {
    return 'Unrated';
  }
  const stars = Number(value.slice(3));
  const least = value.startsWith('min');
  if (least && stars === 1) {
    return 'Rated';
  }
  if (stars === (least ? 5 : 1)) {
    return starsLabel(stars);
  }
  return `${least ? '≥' : '≤'} ${starsLabel(stars)}`;
}

/** Which of the search field's sections lists a rating filter's value; `unrated` stands alone. */
export function ratingFilterSection(value: string): string | undefined {
  if (value.startsWith('min')) {
    return 'At least';
  }
  return value.startsWith('max') ? 'At most' : undefined;
}

/** The rating a form's `rating` field asks for: empty for none. */
export function ratingOf(value: FormDataEntryValue | null): Rating | null {
  const stars = Number(value);
  return isRating(stars) ? stars : null;
}

/** `entries` with the one `rated` names replaced by it, or `null` if none is. */
function withRated(entries: PhotoEntry[], rated: PhotoEntry): PhotoEntry[] | null {
  const at = entries.findIndex((entry) => entry.id === rated.id);
  return at === -1 ? null : entries.with(at, rated);
}

/**
 * Shows `rated` wherever `queries` hold it on screen: in views' pages, listings and folders'
 * covers, until views' new versions arrive from the worker.
 */
function showRated(queries: QueryClient, rated: PhotoEntry): void {
  queries.setQueriesData<ViewPage>(
    { predicate: ({ queryKey }) => queryKey[0] === 'view' && queryKey[2] === 'page' },
    (page) => {
      const rows = page && withRated(page.rows, rated);
      return rows ? { ...page, rows } : page;
    },
  );
  queries.setQueriesData<FolderListing>({ queryKey: ['directory'] }, (listing) => {
    const entries = listing && withRated(listing.entries, rated);
    return entries ? { ...listing, entries } : listing;
  });
  queries.setQueriesData<FolderSummary | null>({ queryKey: ['summary'] }, (summary) => {
    const covers = summary && withRated(summary.covers, rated);
    return covers ? { ...summary, covers } : summary;
  });
}

/**
 * Rates an entry of `library`, or with `null` takes its rating away, and shows it at once
 * wherever it is on screen. Views' new versions follow from the worker, which may then show it
 * elsewhere, or no longer, as their filters say.
 */
export async function rateEntry(library: LibrarySession, entryId: string, rating: Rating | null) {
  const result = await library.api.rateEntry(entryId, rating);
  if (!('error' in result)) {
    showRated(library.queries, result.entry);
  }
  return result;
}
