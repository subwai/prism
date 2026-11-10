import { FILTER_FIELDS, isRatingFilter, type PhotoFilter } from '@prism/shared';

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
