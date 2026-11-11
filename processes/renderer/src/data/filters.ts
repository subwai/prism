import { ratingFilterLabel, ratingFilterSection } from '#data/ratings';
import type { TokenGroup } from '@prism/design-system';
import {
  FILTER_FIELDS,
  type FilterChoice,
  type FilterField,
  isRatingFilter,
  type PhotoFilter,
} from '@prism/shared';

export { FILTER_FIELDS, type FilterField, type PhotoFilter } from '@prism/shared';

/**
 * The search parameter set while the search field is in use, so the worker reads the EXIF
 * details its suggestions offer soon, before any filter narrows the view.
 */
export const SUGGESTING = 'suggest';

/**
 * The view's filters as `params` hold them, each field's values as its repeated parameter. A
 * rating the worker would not know, as a link from before ratings changed could hold, is left
 * out rather than failing the view.
 */
export function photoFilter(params: URLSearchParams): PhotoFilter {
  return {
    camera: params.getAll('camera'),
    format: params.getAll('format'),
    lens: params.getAll('lens'),
    rating: params.getAll('rating').filter((value) => isRatingFilter(value)),
    tag: params.getAll('tag'),
  };
}

/** Whether `filter` narrows anything: with nothing chosen it leaves the view as it is. */
export function narrows(filter: PhotoFilter | null): filter is PhotoFilter {
  return filter !== null && FILTER_FIELDS.some((field) => filter[field].length > 0);
}

const FILTER_LABELS: Record<FilterField, string> = {
  camera: 'Camera',
  format: 'Format',
  lens: 'Lens',
  rating: 'Rating',
  tag: 'Tag',
};

/** How each field's values read, where they are not shown as they are. */
const FILTER_VALUE_LABELS: Partial<Record<FilterField, (value: string) => string>> = {
  rating: ratingFilterLabel,
};

/** The sections a field's values are listed in, for fields that have them. */
const FILTER_SECTIONS: Partial<Record<FilterField, (value: string) => string | undefined>> = {
  rating: ratingFilterSection,
};

/** What the search field offers of `field`: its `values`, labelled as everywhere they are. */
export function filterGroup(field: FilterField, values: FilterChoice[]): TokenGroup {
  return {
    field,
    format: FILTER_VALUE_LABELS[field],
    label: FILTER_LABELS[field],
    section: FILTER_SECTIONS[field],
    values,
  };
}
