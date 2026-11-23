import type { PhotoEntry } from '#photos';

/** The orders a view can sort by. A view sorts by name unless asked otherwise. */
export const SORT_ORDERS = ['name', 'taken', 'modified', 'created', 'size'] as const;
export type SortOrder = (typeof SORT_ORDERS)[number];

/**
 * Which kinds of entries a view includes: `all` for folders, photos and videos; `media` for
 * photos and videos; `images` for photos only.
 */
export const VIEW_ENTRY_KINDS = ['all', 'media', 'images'] as const;
export type ViewEntryKinds = (typeof VIEW_ENTRY_KINDS)[number];

/**
 * The fields a view can be filtered by, each with its own search parameter in the URL: whether
 * entries are photos or videos, their ratings, and details from photos' EXIF data.
 */
export const FILTER_FIELDS = ['format', 'rating', 'camera', 'lens', 'tag'] as const;
export type FilterField = (typeof FILTER_FIELDS)[number];

/**
 * A view's filter: for each field, the values that let an entry through. An entry with any one
 * of them passes. A field with no values chosen lets every entry through. A rating's values are
 * `RATING_FILTERS`, such as `min3` for three stars or more.
 */
export type PhotoFilter = Record<FilterField, string[]>;

export function emptyFilter(): PhotoFilter {
  return { camera: [], format: [], lens: [], rating: [], tag: [] };
}

/**
 * The fields that come from photos' EXIF data, which must be read before a view can filter by
 * them. Photos keep their ratings in their files, so ratings are read along with the rest.
 */
export const EXIF_FIELDS = ['camera', 'lens', 'tag', 'rating'] as const satisfies FilterField[];

/** Whether `filter` uses any field that only photos' EXIF data provides. */
export function needsExif(filter: PhotoFilter): boolean {
  return EXIF_FIELDS.some((field) => filter[field].length > 0);
}

/** The label of each format a view can be filtered to, by entry kind. */
export const FORMAT_LABELS: Partial<Record<PhotoEntry['kind'], string>> = {
  image: 'Photo',
  video: 'Video',
};

/**
 * A value to filter by, and how many entries have it. For a rating, it is how many entries the
 * rating filter lets through.
 */
export interface FilterChoice {
  value: string;
  count: number;
}

/**
 * What a view shows: the entries of a folder, or with `recursive`, everything inside it, sorted
 * and filtered by a search and filters. `show` says which kinds of entries: all of them for the
 * grid, photos and videos for the filmstrip, and photos for the reader. A view never changes
 * what it shows; the window opens another view instead.
 */
export interface ViewSpec {
  directoryId: string;
  recursive: boolean;
  show: ViewEntryKinds;
  sort: SortOrder;
  descending: boolean;
  /** Matches entries whose names, or photos' tags, contain it, ignoring case. */
  search: string;
  filter: PhotoFilter;
  /** Whether the search field is open. Its suggestions need photos' details, so they are read soon. */
  suggesting: boolean;
}

/**
 * A view as it is now. Each `version` has one fixed order, so rows read from the same version
 * always fit together. Changes to the library, such as more of it being read, make a new version.
 */
export interface ViewState {
  viewId: string;
  version: number;
  /** How many entries it shows. */
  count: number;
  /** Whether it is still reading the folders it shows. */
  loading: boolean;
  /** How many of its photos have not had their details read yet. */
  unread: number;
  /** Files in its folders that no view shows, because the app cannot show their formats. */
  unsupported: number;
  /** How many entries could not be read. `viewErrors` lists them. */
  errorCount: number;
  /** Why the view's folder could not be read at all. */
  error: string | null;
}

/** The values a view's photos have for each filter field. */
export interface ViewFacets {
  fields: Record<FilterField, FilterChoice[]>;
  /** How many photos have not had their details read yet, so their values are missing. */
  unread: number;
}

/**
 * Whether a view's sort order or filters need photos' EXIF details. If so, the worker reads
 * them at full speed, and the status bar says how many are left to read.
 */
export function needsDetails({ sort, filter }: Pick<ViewSpec, 'sort' | 'filter'>): boolean {
  return sort === 'taken' || needsExif(filter);
}

/**
 * Whether a view shows folders and everything inside them, which only a view for planning a move
 * to the Trash does. Such a plan lists conflicts: photos that are rated but don't match the
 * filter. To find them, it needs every photo's details read, whatever the view is filtered by.
 */
export function isTrashPlanView({
  recursive,
  show,
}: Pick<ViewSpec, 'recursive' | 'show'>): boolean {
  return recursive && show === 'all';
}

/** The most rows one `viewRows` call returns. */
export const MAX_VIEW_ROWS = 1024;
