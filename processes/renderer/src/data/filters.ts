import { FILTER_FIELDS, type PhotoFilter } from '@prism/shared';

export {
  FILTER_FIELDS,
  type FilterChoice,
  type FilterField,
  type PhotoFilter,
} from '@prism/shared';

/**
 * The search parameter set while the search field is in use, so the worker reads the EXIF
 * details its suggestions offer soon, before any filter narrows the view.
 */
export const SUGGESTING = 'suggest';

/** The view's filters as `params` hold them, each field's values as its repeated parameter. */
export function photoFilter(params: URLSearchParams): PhotoFilter {
  return {
    camera: params.getAll('camera'),
    format: params.getAll('format'),
    lens: params.getAll('lens'),
    rating: params.getAll('rating'),
    tag: params.getAll('tag'),
  };
}

/** Whether `filter` narrows anything: with nothing chosen it leaves the view as it is. */
export function narrows(filter: PhotoFilter | null): filter is PhotoFilter {
  return filter !== null && FILTER_FIELDS.some((field) => filter[field].length > 0);
}
