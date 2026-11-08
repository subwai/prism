import type { PhotoEntry, ReadError } from '#photos';

export type SortOrder = 'name' | 'taken' | 'modified' | 'created' | 'size';

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
  show: 'all' | 'media' | 'images';
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

/** The most rows one `viewRows` call returns. */
export const MAX_VIEW_ROWS = 1024;
