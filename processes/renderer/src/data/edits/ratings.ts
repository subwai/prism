import type { LibrarySession } from '#data/library';
import type { ViewPage } from '#data/views/gallery-view';
import {
  type FolderListing,
  isRating,
  isRatingFilter,
  type PhotoEntry,
  type Rating,
} from '@prism/shared';
import type { QueryClient } from '@tanstack/react-query';

export { toggleRating, RATINGS, type Rating } from '@prism/shared';

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

/** Whether a query's data, a view's page or a listing, shows `entryId`, itself or as a folder's cover. */
function showsEntry(key: readonly unknown[], data: unknown, entryId: string): boolean {
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
 * Reads again every query that shows `entryId`: views' pages, listings and folders' covers,
 * including pages a newer read stands in for, so none of them shows the entry as it was. Reads
 * already under way are left to finish: the catalog has the rating before the worker answers,
 * so reads answered after that have it too.
 */
async function refetchQueriesShowing(queries: QueryClient, entryId: string) {
  await queries.invalidateQueries(
    {
      predicate: ({ queryKey, state }) => showsEntry(queryKey, state.data, entryId),
      refetchType: 'all',
    },
    { cancelRefetch: false },
  );
}

/**
 * Rates an entry of `library`, or takes its rating away with `null`.
 * - The rating shows at once wherever the entry is on screen, through the session's pending edits.
 * - Then it shows as the worker answered, until what showed it is read again.
 * - If it fails, the old rating shows again.
 *
 * The worker then gives views new versions, which may move the entry, or drop it, as their
 * filters say.
 */
export function rateEntry(library: LibrarySession, entryId: string, rating: Rating | null) {
  const { edits } = library;
  const id = edits.currentIdOf(entryId);
  return edits.run(id, 'rating', rating, async (edit) => {
    const result = await library.api.rateEntry(id, rating);
    if (!('error' in result)) {
      edits.settle(id, 'rating', edit, result.entry.rating ?? null);
      await refetchQueriesShowing(library.queries, id).catch(() => null);
    }
    return result;
  });
}
