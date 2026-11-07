import { matches, narrows, type PhotoFilter } from '#data/filters';
import type { PhotoEntry, PhotoExif, PhotoMetadata } from '@prism/shared';

export type SortOrder = 'name' | 'taken' | 'modified' | 'created' | 'size';
/** The ways to view a folder, in the order the View menu's switch steps through them. */
export const VIEW_MODES = ['grid', 'filmstrip', 'reader'] as const;
export type ViewMode = (typeof VIEW_MODES)[number];

/** Thumbnail sizes a view opens with, and that its slider goes back to on a double-click. */
export const THUMBNAIL_SIZE: Record<Exclude<ViewMode, 'reader'>, number> = {
  filmstrip: 76,
  grid: 170,
};

/** How wide the reader shows pages until its slider changes it, in CSS pixels. */
export const PAGE_WIDTH = 800;

/**
 * About how many `tile`-pixel tiles fit in a share of the window: a grid of `rows` fills it,
 * and a strip is one row.
 */
export function screenful(tile: number, { width = 1, height = 1, rows = true } = {}) {
  const columns = Math.ceil((globalThis.innerWidth * width) / tile);
  return rows ? columns * Math.ceil((globalThis.innerHeight * height) / tile) : columns;
}

/** Photos and videos: what the viewer shows and a slideshow steps through. */
export function isMedia(entry: PhotoEntry) {
  return entry.kind === 'image' || entry.kind === 'video';
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const SORT_FIELDS: Record<Exclude<SortOrder, 'name' | 'taken'>, keyof PhotoMetadata> = {
  created: 'createdMs',
  modified: 'modifiedMs',
  size: 'size',
};

/**
 * What `sort` orders entries by, or `null` for their names. Photos without a time taken, and
 * videos, go by when they were last modified, which copying a file usually keeps.
 */
function sortValue(sort: SortOrder): ((entry: PhotoEntry) => number) | null {
  if (sort === 'name') {
    return null;
  }
  if (sort === 'taken') {
    return (entry) => entry.exif?.takenMs ?? entry.metadata?.modifiedMs ?? 0;
  }
  const field = SORT_FIELDS[sort];
  return (entry) => entry.metadata?.[field] ?? 0;
}

/**
 * Folders first, then photos and videos mixed, in `sort` order with names breaking ties. Sorts
 * by a value break them by `rank`, each entry's place in the list sorted by name, as the
 * collator is slow enough to take most of a sort's time.
 */
function comparator(sort: SortOrder, descending: boolean, rank?: (entry: PhotoEntry) => number) {
  const value = sortValue(sort);
  const direction = descending ? -1 : 1;
  return (left: PhotoEntry, right: PhotoEntry) => {
    if ((left.kind === 'directory') !== (right.kind === 'directory')) {
      return left.kind === 'directory' ? -1 : 1;
    }
    const comparison =
      (value ? value(left) - value(right) : 0) ||
      (rank ? rank(left) - rank(right) : collator.compare(left.name, right.name));
    return direction * comparison || collator.compare(left.id, right.id);
  };
}

/** Two sorted lists as one. */
function merge<Item>(left: Item[], right: Item[], compare: (first: Item, second: Item) => number) {
  if (right.length === 0) {
    return left;
  }
  const merged: Item[] = [];
  let index = 0;
  for (const item of left) {
    while (index < right.length && compare(right[index] as Item, item) < 0) {
      merged.push(right[index] as Item);
      index += 1;
    }
    merged.push(item);
  }
  return [...merged, ...right.slice(index)];
}

/**
 * Lists that only grow, each page of a scan appending to the last, share a lineage: a sorted
 * earlier list then only needs the new entries sorted into it.
 */
const lineages = new WeakMap<PhotoEntry[], object>();
const sortedByLineage = new WeakMap<object, Map<string, { length: number; list: PhotoEntry[] }>>();
const sortedLists = new WeakMap<PhotoEntry[], Map<string, PhotoEntry[]>>();
/**
 * Lists that hold an earlier one's entries in its order, some with details read since, keep its
 * order by name. Each points to the first of them, so they do not hold on to one another.
 */
const refilled = new WeakMap<PhotoEntry[], PhotoEntry[]>();
const nameRanks = new WeakMap<PhotoEntry[], Map<string, number>>();

/** Records that `entries` extends earlier lists of the same `lineage`, such as a scan's. */
export function extendsLineage(entries: PhotoEntry[], lineage: object) {
  lineages.set(entries, lineage);
}

/**
 * Records that `entries` holds the entries of `previous` in the same order, some with their
 * metadata or EXIF details filled in, so its order by name need not be worked out again.
 */
export function refills(entries: PhotoEntry[], previous: PhotoEntry[]) {
  refilled.set(entries, refilled.get(previous) ?? previous);
}

/** `list` with each entry as `entries` has it now. */
function sameOrder(list: PhotoEntry[], entries: PhotoEntry[]) {
  const current = new Map(entries.map((entry) => [entry.id, entry]));
  return list.map((entry) => current.get(entry.id) ?? entry);
}

/** Each entry's place in `entries` sorted by name. */
function nameRank(entries: PhotoEntry[]) {
  let ranks = nameRanks.get(entries);
  if (!ranks) {
    ranks = new Map(sorted(entries, 'name', false, false).map((entry, index) => [entry.id, index]));
    nameRanks.set(entries, ranks);
  }
  const found = ranks;
  return (entry: PhotoEntry) => found.get(entry.id) ?? 0;
}

function cached<Key extends WeakKey, Value>(map: WeakMap<Key, Map<string, Value>>, key: Key) {
  let values = map.get(key);
  if (!values) {
    values = new Map();
    map.set(key, values);
  }
  return values;
}

/** What a view shows of `entries`, sorted; the same list for the same arguments. */
function sorted(entries: PhotoEntry[], sort: SortOrder, descending: boolean, mediaOnly: boolean) {
  const key = `${sort}:${descending}:${mediaOnly}`;
  const ready = cached(sortedLists, entries);
  let list = ready.get(key);
  if (list) {
    return list;
  }
  const compare = comparator(sort, descending, sort === 'name' ? undefined : nameRank(entries));
  const shown = (entry: PhotoEntry) => isMedia(entry) || (!mediaOnly && entry.kind === 'directory');
  const lineage = lineages.get(entries);
  const earlier = lineage && cached(sortedByLineage, lineage).get(key);
  const before = refilled.get(entries);
  if (earlier && earlier.length <= entries.length) {
    list = merge(
      earlier.list,
      entries
        .slice(earlier.length)
        .filter((entry) => shown(entry))
        .toSorted(compare),
      compare,
    );
  } else if (before && sort === 'name') {
    // Details read since leave the order by name as it was.
    list = sameOrder(sorted(before, sort, descending, mediaOnly), entries);
  } else {
    list = entries.filter((entry) => shown(entry)).toSorted(compare);
  }
  ready.set(key, list);
  if (lineage) {
    cached(sortedByLineage, lineage).set(key, { length: entries.length, list });
  }
  return list;
}

/**
 * The entries a view shows, in order: folders first unless `mediaOnly`, then photos and
 * videos, narrowed to those whose names, or tags where known, contain `search`. Searching
 * narrows the sorted list rather than sorting again. The result is shared, so callers must not
 * change it.
 */
export function arrangeEntries(
  entries: PhotoEntry[],
  search: string,
  sort: SortOrder,
  descending: boolean,
  mediaOnly = false,
) {
  const list = sorted(entries, sort, descending, mediaOnly);
  const query = search.trim().toLocaleLowerCase();
  const found = (text: string) => text.toLocaleLowerCase().includes(query);
  return query
    ? list.filter((entry) => found(entry.name) || entry.exif?.tags?.some((tag) => found(tag)))
    : list;
}

/**
 * What `mode` shows of a folder's `entries`, arranged as `arrangeEntries` does: the grid shows
 * folders too, the filmstrip photos and videos, and the reader only photos. A `filter` that
 * narrows the view leaves only the photos it matches.
 */
export function arrangeView(
  entries: PhotoEntry[],
  mode: ViewMode,
  {
    search,
    sort,
    descending,
    filter = null,
  }: { search: string; sort: SortOrder; descending: boolean; filter?: PhotoFilter | null },
) {
  const list = arrangeEntries(entries, search, sort, descending, mode !== 'grid');
  if (narrows(filter)) {
    return list.filter((entry) => matches(entry, filter));
  }
  return mode === 'reader' ? list.filter((entry) => entry.kind === 'image') : list;
}

export function formatSize(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), 3);
  return `${(bytes / 1024 ** unit).toFixed(1)} ${['B', 'KB', 'MB', 'GB'][unit]}`;
}

/** How a photo was taken, as a camera shows it: "Canon EOS R5 · 50 mm · ƒ/2.8 · 1/250 s · ISO 400". */
export function describeExif({ camera, focalLength, aperture, exposureSeconds, iso }: PhotoExif) {
  let exposure: string | undefined;
  if (exposureSeconds !== undefined) {
    exposure =
      exposureSeconds < 1 ? `1/${Math.round(1 / exposureSeconds)} s` : `${exposureSeconds} s`;
  }
  return [
    camera,
    focalLength === undefined ? undefined : `${Math.round(focalLength)} mm`,
    aperture === undefined ? undefined : `ƒ/${aperture}`,
    exposure,
    iso === undefined ? undefined : `ISO ${iso}`,
  ]
    .filter(Boolean)
    .join(' · ');
}
