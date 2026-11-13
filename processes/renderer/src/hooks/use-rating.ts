import { nextRating, type Rating, RATINGS } from '#data/ratings';
import { useShownEntry } from '#hooks/use-library';
import type { Command } from '@prism/keybindings';
import type { PhotoEntry } from '@prism/shared';
import { useFetcher } from 'react-router';

type RateResult = { error: string } | { rated: PhotoEntry };

/** Stands in for an entry not known yet, which nothing rates. */
const NONE: PhotoEntry = { id: '', kind: 'file', name: '', parentId: '' };

/**
 * Rating `entry`, through the library's action. A rating chosen shows at once wherever the
 * entry is, from the library's pending edits, while it is written. Every place that rates the
 * same entry shares the one fetcher, so each says why a rating did not take. Choosing the stars
 * it is rated takes its rating away.
 */
export function useRating(entry: PhotoEntry | null | undefined) {
  const fetcher = useFetcher<RateResult>({ key: `rate:${entry?.id ?? ''}` });
  const shown = useShownEntry(entry ?? NONE);
  const rating = entry ? shown.rating : undefined;
  function rate(stars: Rating | null) {
    if (entry) {
      fetcher
        .submit(
          { entryId: entry.id, intent: 'rate', rating: stars ?? '' },
          { action: '/library', method: 'post' },
        )
        .catch(() => null);
    }
  }
  const choose = (stars: Rating) => rate(nextRating(rating, stars));
  const clear = () => {
    if (rating !== undefined) {
      rate(null);
    }
  };
  const commands: Partial<Record<Command, () => void>> = { unrate: clear };
  for (const stars of RATINGS) {
    commands[`rate${stars}`] = () => choose(stars);
  }
  return {
    choose,
    clear,
    /** The rating commands' handlers, for `useCommands`. */
    commands,
    /** Why the last rating did not take. */
    error: fetcher.data && 'error' in fetcher.data ? fetcher.data.error : undefined,
    rating,
  };
}
