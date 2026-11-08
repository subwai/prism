import { kindOf } from '#photos/catalog/data/codes';
import type { CatalogDatabase } from '#photos/catalog/data/database';
import { countUnread } from '#photos/catalog/data/details';
import { countMedia, countTags, countValues } from '#photos/catalog/data/filters';
import type { Scope } from '#photos/catalog/data/scope';
import { type FilterChoice, FORMATS, type ViewFacets } from '@prism/shared';

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function sorted(choices: FilterChoice[]) {
  return choices.toSorted((left, right) => collator.compare(left.value, right.value));
}

/** What `scope` holds of each value to filter by, and how many photos lack their details. */
export function facetsOf(db: CatalogDatabase, library: number, scope: Scope): ViewFacets {
  const formats = countMedia(db, library, scope).flatMap(({ kind, count }) => {
    const value = FORMATS[kindOf(kind)];
    return value ? [{ count, value }] : [];
  });
  return {
    fields: {
      camera: sorted(countValues(db, library, scope, 'camera')),
      format: sorted(formats),
      lens: sorted(countValues(db, library, scope, 'lens')),
      tag: sorted(countTags(db, library, scope)),
    },
    unread: countUnread(db, library, scope),
  };
}
