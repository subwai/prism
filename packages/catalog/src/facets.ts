import { kindOf } from '#data/codes';
import type { CatalogDatabase } from '#data/database';
import { countUnread } from '#data/details';
import { countMedia, countRatings, countTags, countValues } from '#data/filters';
import type { Scope } from '#data/scope';
import { countStored, type StoredRatings } from '#stored-ratings';
import { type FilterChoice, FORMATS, RATINGS, type ViewFacets } from '@prism/shared';

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function sorted(choices: FilterChoice[]) {
  return choices.toSorted((left, right) => collator.compare(left.value, right.value));
}

/**
 * How many entries of `scope` have each number of stars or more, most stars first, leaving out
 * numbers none have.
 */
function ratingChoices(
  db: CatalogDatabase,
  library: number,
  scope: Scope,
  stored: StoredRatings,
): FilterChoice[] {
  const counts = [...countRatings(db, library, scope), ...countStored(db, library, scope, stored)];
  return RATINGS.toReversed().flatMap((stars) => {
    const count = counts
      .filter(({ rating }) => rating >= stars)
      .reduce((total, { count: each }) => total + each, 0);
    return count > 0 ? [{ count, value: String(stars) }] : [];
  });
}

/** What `scope` holds of each value to filter by, and how many photos lack their details. */
export function facetsOf(
  db: CatalogDatabase,
  library: number,
  scope: Scope,
  stored: StoredRatings,
): ViewFacets {
  const formats = countMedia(db, library, scope).flatMap(({ kind, count }) => {
    const value = FORMATS[kindOf(kind)];
    return value ? [{ count, value }] : [];
  });
  return {
    fields: {
      camera: sorted(countValues(db, library, scope, 'camera')),
      format: sorted(formats),
      lens: sorted(countValues(db, library, scope, 'lens')),
      rating: ratingChoices(db, library, scope, stored),
      tag: sorted(countTags(db, library, scope)),
    },
    unread: countUnread(db, library, scope),
  };
}
