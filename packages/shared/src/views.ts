import type { PhotoEntry, ReadError } from '#photos';

/** The orders a view can sort by; a view sorts by name unless asked otherwise. */
export const SORT_ORDERS = ['name', 'taken', 'modified', 'created', 'size'] as const;
export type SortOrder = (typeof SORT_ORDERS)[number];

/** What a view can show: folders, photos and videos; photos and videos; or photos alone. */
export const VIEW_SHOWS = ['all', 'media', 'images'] as const;

/**
 * What a view can be narrowed to, each by its search parameter: whether entries are photos or
 * videos, and photos' EXIF details.
 */
export const FILTER_FIELDS = ['format', 'camera', 'lens', 'tag'] as const;
export type FilterField = (typeof FILTER_FIELDS)[number];

/**
 * What the view is narrowed to: for each field, the values an entry may have, any of which lets
 * it through. A field with none chosen lets every entry through.
 */
export type PhotoFilter = Record<FilterField, string[]>;

/** A filter that lets every entry through. */
export function emptyFilter(): PhotoFilter {
  return { camera: [], format: [], lens: [], tag: [] };
}

/** The fields only photos' EXIF details say, which have to be read before a view can use them. */
export const EXIF_FIELDS = ['camera', 'lens', 'tag'] as const satisfies FilterField[];

/** Whether `filter` narrows by anything only photos' EXIF details say. */
export function needsExif(filter: PhotoFilter): boolean {
  return EXIF_FIELDS.some((field) => filter[field].length > 0);
}

/** The formats an entry can be filtered to, by its kind. */
export const FORMATS: Partial<Record<PhotoEntry['kind'], string>> = {
  image: 'Photo',
  video: 'Video',
};

/** A value to filter by, and how many entries have it. */
export interface FilterChoice {
  value: string;
  count: number;
}

/**
 * What a view shows: the entries of a folder, or with `recursive` of everything inside it, in
 * order, narrowed by a search and filters. `show` says which kinds: folders, photos and videos
 * for the grid, photos and videos for the filmstrip, and photos for the reader. A view never
 * changes what it shows; another one does.
 */
export interface ViewSpec {
  directoryId: string;
  recursive: boolean;
  show: (typeof VIEW_SHOWS)[number];
  sort: SortOrder;
  descending: boolean;
  /** Matches entries whose names, or photos' tags, contain it, ignoring case. */
  search: string;
  filter: PhotoFilter;
  /** The search field is open, so its suggestions want photos' details read soon. */
  suggesting: boolean;
}

/**
 * A view as it is now. Each `version` is a fixed order, so the rows of one version always fit
 * together; changes to the library, such as more of it being read, make a new one.
 */
export interface ViewState {
  viewId: string;
  version: number;
  /** How many entries it shows. */
  count: number;
  /** Still reading the folders it shows. */
  loading: boolean;
  /** Photos it holds whose details have yet to be read. */
  unread: number;
  errors: ReadError[];
  /** Why the view's folder could not be read at all. */
  error: string | null;
}

/** The values a view's photos have for each field, to filter by. */
export interface ViewFacets {
  fields: Record<FilterField, FilterChoice[]>;
  /** Photos whose details have yet to be read, so their values are missing. */
  unread: number;
}

/**
 * Whether a view's order or filters need photos' EXIF details, which the worker then reads at
 * full speed, and the status bar says how many it has still to read.
 */
export function needsDetails({ sort, filter }: Pick<ViewSpec, 'sort' | 'filter'>): boolean {
  return sort === 'taken' || needsExif(filter);
}

/** The most rows one `viewRows` call returns. */
export const MAX_VIEW_ROWS = 1024;
