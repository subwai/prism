import type { PhotoEntry, PhotoExif } from '@prism/shared';

/** The EXIF details a view can be narrowed to, each by its search parameter. */
export const FILTER_FIELDS = ['camera', 'lens'] as const satisfies (keyof PhotoExif)[];
export type FilterField = (typeof FILTER_FIELDS)[number];

/** The search parameter that shows the filters, even before any narrows the view. */
export const FILTERS_SHOWN = 'filter';

/** What the view is narrowed to: an empty value lets every photo through. */
export type PhotoFilter = Record<FilterField, string>;

/** The view's filters as `params` hold them, or `null` while they are hidden. */
export function photoFilter(params: URLSearchParams): PhotoFilter | null {
  if (!params.has(FILTERS_SHOWN)) {
    return null;
  }
  return { camera: params.get('camera') ?? '', lens: params.get('lens') ?? '' };
}

/** Whether `filter` narrows anything: shown filters with nothing chosen leave the view as it is. */
export function narrows(filter: PhotoFilter | null): filter is PhotoFilter {
  return filter !== null && FILTER_FIELDS.some((field) => filter[field] !== '');
}

/** Whether `entry` is a photo whose EXIF details match everything `filter` chooses. */
export function matches(entry: PhotoEntry, filter: PhotoFilter): boolean {
  return (
    entry.kind === 'image' &&
    FILTER_FIELDS.every((field) => !filter[field] || entry.exif?.[field] === filter[field])
  );
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** The values of `field` among `entries`' photos, in order, to choose a filter from. */
export function filterChoices(entries: PhotoEntry[], field: FilterField): string[] {
  const values = new Set<string>();
  for (const entry of entries) {
    const value = entry.exif?.[field];
    if (value) {
      values.add(value);
    }
  }
  return [...values].toSorted((left, right) => collator.compare(left, right));
}
