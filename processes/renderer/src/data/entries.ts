import type { PhotoEntry, PhotoMetadata } from '@prism/shared';

export type SortOrder = 'name' | 'modified' | 'created' | 'size';
export type ViewMode = 'grid' | 'filmstrip';

/** Thumbnail sizes a view opens with, and that its slider goes back to on a double-click. */
export const THUMBNAIL_SIZE: Record<ViewMode, number> = { filmstrip: 76, grid: 170 };

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
const SORT_FIELDS: Record<Exclude<SortOrder, 'name'>, keyof PhotoMetadata> = {
  created: 'createdMs',
  modified: 'modifiedMs',
  size: 'size'
};

/** Folders first, then photos and videos mixed, in `sort` order with names breaking ties. */
function comparator(sort: SortOrder, descending: boolean) {
  const field = sort === 'name' ? null : SORT_FIELDS[sort];
  const direction = descending ? -1 : 1;
  return (left: PhotoEntry, right: PhotoEntry) => {
    if ((left.kind === 'directory') !== (right.kind === 'directory')) {
      return left.kind === 'directory' ? -1 : 1;
    }
    const comparison =
      (field ? (left.metadata?.[field] ?? 0) - (right.metadata?.[field] ?? 0) : 0) ||
      collator.compare(left.name, right.name);
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

/** Records that `entries` extends earlier lists of the same `lineage`, such as a scan's. */
export function extendsLineage(entries: PhotoEntry[], lineage: object) {
  lineages.set(entries, lineage);
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
  const compare = comparator(sort, descending);
  const shown = (entry: PhotoEntry) => isMedia(entry) || (!mediaOnly && entry.kind === 'directory');
  const lineage = lineages.get(entries);
  const earlier = lineage && cached(sortedByLineage, lineage).get(key);
  list =
    earlier && earlier.length <= entries.length
      ? merge(
          earlier.list,
          entries
            .slice(earlier.length)
            .filter((entry) => shown(entry))
            .toSorted(compare),
          compare
        )
      : entries.filter((entry) => shown(entry)).toSorted(compare);
  ready.set(key, list);
  if (lineage) {
    cached(sortedByLineage, lineage).set(key, { length: entries.length, list });
  }
  return list;
}

/**
 * The entries a view shows, in order: folders first unless `mediaOnly`, then photos and
 * videos, narrowed to names containing `search`. Searching narrows the sorted list rather
 * than sorting again. The result is shared, so callers must not change it.
 */
export function arrangeEntries(
  entries: PhotoEntry[],
  search: string,
  sort: SortOrder,
  descending: boolean,
  mediaOnly = false
) {
  const list = sorted(entries, sort, descending, mediaOnly);
  const query = search.trim().toLocaleLowerCase();
  return query ? list.filter((entry) => entry.name.toLocaleLowerCase().includes(query)) : list;
}

export function formatSize(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), 3);
  return `${(bytes / 1024 ** unit).toFixed(1)} ${['B', 'KB', 'MB', 'GB'][unit]}`;
}
