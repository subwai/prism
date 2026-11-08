import type { PhotoEntry } from '@prism/shared';

/**
 * What a view can be narrowed to, each by its search parameter: whether entries are photos or
 * videos, and photos' EXIF details.
 */
export const FILTER_FIELDS = ['format', 'camera', 'lens', 'tag'] as const;
export type FilterField = (typeof FILTER_FIELDS)[number];

/** The filters that need photos' EXIF details read. */
const EXIF_FIELDS = ['camera', 'lens', 'tag'] as const satisfies FilterField[];

/** The formats an entry can be filtered to, by its kind. */
const FORMATS: Partial<Record<PhotoEntry['kind'], string>> = { image: 'Photo', video: 'Video' };

/** The values an entry has for each filter: a photo has one camera and lens, but many tags. */
const VALUES: Record<FilterField, (entry: PhotoEntry) => (string | undefined)[]> = {
  camera: ({ exif }) => [exif?.camera],
  format: ({ kind }) => [FORMATS[kind]],
  lens: ({ exif }) => [exif?.lens],
  tag: ({ exif }) => exif?.tags ?? [],
};

/**
 * The search parameter set while the search field is in use, so the scan reads the EXIF details
 * its suggestions offer before any filter narrows the view.
 */
export const SUGGESTING = 'suggest';

/**
 * What the view is narrowed to: for each field, the values an entry may have, any of which lets
 * it through. A field with none chosen lets every entry through.
 */
export type PhotoFilter = Record<FilterField, string[]>;

/** The view's filters as `params` hold them, each field's values as its repeated parameter. */
export function photoFilter(params: URLSearchParams): PhotoFilter {
  return {
    camera: params.getAll('camera'),
    format: params.getAll('format'),
    lens: params.getAll('lens'),
    tag: params.getAll('tag'),
  };
}

/** Whether `filter` narrows anything: with nothing chosen it leaves the view as it is. */
export function narrows(filter: PhotoFilter | null): filter is PhotoFilter {
  return filter !== null && FILTER_FIELDS.some((field) => filter[field].length > 0);
}

/** Whether `filter` narrows by anything only photos' EXIF details say. */
export function needsExif(filter: PhotoFilter): boolean {
  return EXIF_FIELDS.some((field) => filter[field].length > 0);
}

/** Whether `entry` has one of the values of every field `filter` chooses; folders never do. */
export function matches(entry: PhotoEntry, filter: PhotoFilter): boolean {
  return FILTER_FIELDS.every((field) => {
    const chosen = filter[field];
    return (
      chosen.length === 0 ||
      VALUES[field](entry).some((value) => value !== undefined && chosen.includes(value))
    );
  });
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** A value to filter by, and how many entries have it. */
export interface FilterChoice {
  value: string;
  count: number;
}

/** The values of `field` among `entries`, in order, to choose a filter from. */
export function filterChoices(entries: PhotoEntry[], field: FilterField): FilterChoice[] {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    for (const value of new Set(VALUES[field](entry))) {
      if (value) {
        counts.set(value, (counts.get(value) ?? 0) + 1);
      }
    }
  }
  return [...counts]
    .map(([value, count]) => ({ count, value }))
    .toSorted((left, right) => collator.compare(left.value, right.value));
}
