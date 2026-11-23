import type { CatalogDatabase } from '#database/catalog-database';
import {
  countMedia,
  countRateable,
  countRatings,
  countValues,
} from '#repositories/entries/filters';
import { countTags } from '#repositories/entry-tags';
import { kindOf } from '#repositories/queries/codes';
import type { Scope } from '#repositories/queries/scope';
import { countStored, type StoredRatings } from '#services/ratings/stored-ratings';
import {
  type FilterChoice,
  FORMAT_LABELS,
  passesRatingFilter,
  RATING_FILTERS,
  type ViewFacets,
} from '@prism/shared';

// A scope is the folders a view or query covers: one folder, or it and every folder inside it.
// Facets are the values a view can be filtered by, such as its cameras, with how many photos have
// each.

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

/** What `scope` holds of each value to filter by. */
export function facetsOf(
  db: CatalogDatabase,
  library: number,
  scope: Scope,
  stored: StoredRatings,
): ViewFacets['fields'] {
  const formats = countMedia(db, library, scope).flatMap(({ kind, count }) => {
    const value = FORMAT_LABELS[kindOf(kind)];
    return value ? [{ count, value }] : [];
  });
  return {
    camera: sorted(countValues(db, library, scope, 'camera')),
    format: sorted(formats),
    lens: sorted(countValues(db, library, scope, 'lens')),
    rating: ratingChoices(db, library, scope, stored),
    tag: sorted(countTags(db, library, scope)),
  };
}
