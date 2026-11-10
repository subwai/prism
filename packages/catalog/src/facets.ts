import { kindOf } from '#data/codes';
import type { CatalogDatabase } from '#data/database';
import { countUnread } from '#data/details';
import { countMedia, countRateable, countRatings, countTags, countValues } from '#data/filters';
import type { Scope } from '#data/scope';
import { countStored, type StoredRatings } from '#stored-ratings';
import {
  type FilterChoice,
  FORMATS,
  passesRatingFilter,
  RATING_FILTERS,
  type ViewFacets,
} from '@prism/shared';

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function sorted(choices: FilterChoice[]) {
  return choices.toSorted((left, right) => collator.compare(left.value, right.value));
}

/**
 * How many entries of `scope` each rating filter lets through, in `RATING_FILTERS`' order,
 * leaving out those that let none through. What is not rated counts as unrated, folders too,
 * as a rating filter keeps folders.
 */
function ratingChoices(
  db: CatalogDatabase,
  library: number,
  scope: Scope,
  stored: StoredRatings,
): FilterChoice[] {
  const counts = [...countRatings(db, library, scope), ...countStored(db, library, scope, stored)];
  const rated = counts.reduce((total, { count }) => total + count, 0);
  const unrated = countRateable(db, library, scope) - rated;
  return RATING_FILTERS.flatMap((value) => {
    const count =
      value === 'unrated'
        ? unrated
        : counts
            .filter(({ rating }) => passesRatingFilter(value, rating))
            .reduce((total, { count: each }) => total + each, 0);
    return count > 0 ? [{ count, value }] : [];
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
