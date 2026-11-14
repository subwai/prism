import type { ViewPage } from '#data/gallery-view';
import type { LibrarySession } from '#data/library';
import {
  type FolderListing,
  isRating,
  isRatingFilter,
  type PhotoEntry,
  type Rating,
} from '@prism/shared';
import type { QueryClient } from '@tanstack/react-query';

export { nextRating, RATINGS, type Rating } from '@prism/shared';

/** How many stars `stars` is, in words, as screen readers and menus say it. */
function starsLabel(stars: number): string {
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

/** Whether a query's data, a view's page or a listing, shows `entryId`, or as a folder's cover. */
function shows(key: readonly unknown[], data: unknown, entryId: string): boolean {
  let entries: PhotoEntry[] | undefined;
  if (key[0] === 'view' && key[2] === 'page') {
    entries = (data as ViewPage | undefined)?.rows;
  } else if (key[0] === 'directory') {
    entries = (data as FolderListing | undefined)?.entries;
  }
  return (
    entries?.some(
      (entry) =>
        entry.id === entryId || entry.summary?.covers.some((cover) => cover.id === entryId),
    ) ?? false
  );
}

/**
 * Reads again what `queries` hold of `entryId`, in views' pages, listings and folders' covers,
 * including the pages a newer read stands in for, so none of it shows the entry as it was.
 * Reads under way are left to finish: the catalog has a rating before the worker answers, so
 * those answered after it have it too.
 */
async function readAgain(queries: QueryClient, entryId: string) {
  await queries.invalidateQueries(
    {
      predicate: ({ queryKey, state }) => shows(queryKey, state.data, entryId),
      refetchType: 'all',
    },
    { cancelRefetch: false },
  );
}

/**
 * Rates an entry of `library`, or with `null` takes its rating away. The rating shows at once
 * wherever the entry is on screen, through the session's pending edits, and then as the worker
 * answered until what showed it is read again, or the old one shows again if it fails. Views'
 * new versions follow from the worker, which may then show it elsewhere, or no longer, as
 * their filters say.
 */
export function rateEntry(library: LibrarySession, entryId: string, rating: Rating | null) {
  const { edits } = library;
  const id = edits.follow(entryId);
  return edits.run(id, 'rating', rating, async (edit) => {
    const result = await library.api.rateEntry(id, rating);
    if (!('error' in result)) {
      edits.settle(id, 'rating', edit, result.entry.rating ?? null);
      await readAgain(library.queries, id).catch(() => null);
    }
    return result;
  });
}
