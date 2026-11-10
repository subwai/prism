import { KIND_CODES } from '#data/codes';
import type { CatalogDatabase } from '#data/database';
import { allTags, having, maxItem, named, ratedAtLeast, tagged } from '#data/filters';
import type { ScopeOrder } from '#data/orders';
import type { Scope } from '#data/scope';
import { storedAtLeast, type StoredRatings } from '#stored-ratings';
import {
  FILTER_FIELDS,
  FORMATS,
  type PhotoEntry,
  type ViewShow,
  type ViewSpec,
} from '@prism/shared';

type Kind = PhotoEntry['kind'];

// The kinds each view shows.
const SHOWN: Record<ViewShow, Kind[]> = {
  all: ['directory', 'image', 'video'],
  images: ['image'],
  media: ['image', 'video'],
};
const FORMAT_KINDS = new Map(
  Object.entries(FORMATS).map(([kind, format]) => [format, kind as Kind]),
);

/** A set of entry numbers as a byte per number, as views test thousands at a time. */
function setOf(numbers: Iterable<number>, size: number) {
  const set = new Uint8Array(size + 1);
  for (const item of numbers) {
    set[item] = 1;
  }
  return set;
}

/** The kinds a view shows, as a flag per kind code. */
export function shownKinds({ show, filter }: ViewSpec): Uint8Array {
  let kinds = SHOWN[show];
  // Folders have none of the values filters choose, but for ratings.
  if (FILTER_FIELDS.some((field) => field !== 'rating' && filter[field].length > 0)) {
    kinds = kinds.filter((kind) => kind !== 'directory');
  }
  if (filter.format.length > 0) {
    const formats = new Set(filter.format.map((format) => FORMAT_KINDS.get(format)));
    kinds = kinds.filter((kind) => formats.has(kind));
  }
  const shown = new Uint8Array(Object.keys(KIND_CODES).length);
  for (const kind of kinds) {
    shown[KIND_CODES[kind]] = 1;
  }
  return shown;
}

/**
 * The sets of entries a view's search and filters let through, every one of which an entry
 * must be in. Each comes from an index of its own, rather than one query per combination,
 * which SQLite plans badly.
 */
export function filterSets(
  db: CatalogDatabase,
  library: number,
  scope: Scope,
  { filter, search }: ViewSpec,
  stored: StoredRatings,
): Uint8Array[] {
  const size = maxItem(db);
  const sets: Uint8Array[] = [];
  if (filter.rating.length > 0) {
    // Each value is the fewest stars it lets through, so together the fewest of them do.
    const stars = Math.min(...filter.rating.map(Number));
    sets.push(
      setOf(
        [...ratedAtLeast(db, library, stars), ...storedAtLeast(db, library, stored, stars)],
        size,
      ),
    );
  }
  for (const field of ['camera', 'lens'] as const) {
    if (filter[field].length > 0) {
      sets.push(setOf(having(db, library, scope, field, filter[field]), size));
    }
  }
  if (filter.tag.length > 0) {
    sets.push(setOf(tagged(db, library, filter.tag), size));
  }
  const text = search.trim().toLocaleLowerCase();
  if (text) {
    // A search matches photos' tags as well as names.
    const tags = allTags(db, library).filter((tag) => tag.toLocaleLowerCase().includes(text));
    const withTags = tags.length > 0 ? tagged(db, library, tags) : [];
    sets.push(setOf([...named(db, library, scope, text), ...withTags], size));
  }
  return sets;
}

/** Whether the entry `item` is in every one of `sets`. */
function inEvery(sets: Uint8Array[], item: number) {
  for (const set of sets) {
    if (set[item] !== 1) {
      return false;
    }
  }
  return true;
}

/**
 * The entries of `order` a view shows: those of the kinds it shows, in every one of `sets`.
 * Folders come first either way, so a descending view reverses each group on its own.
 */
export function narrow(
  { items, kinds }: ScopeOrder,
  shown: Uint8Array,
  sets: Uint8Array[],
  descending: boolean,
): Int32Array {
  const made = new Int32Array(items.length);
  let count = 0,
    folders = 0;
  // A plain loop: this runs over every entry of a scope, up to millions, each time a view is
  // made, and an iterator's pair and a callback per entry more than double its time.
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index] ?? 0;
    const kind = kinds[index] ?? KIND_CODES.file;
    if (shown[kind] !== 1 || !inEvery(sets, item)) {
      continue;
    }
    made[count] = item;
    count += 1;
    if (kind === KIND_CODES.directory) {
      folders += 1;
    }
  }
  const result = made.subarray(0, count);
  if (descending) {
    result.subarray(0, folders).reverse();
    result.subarray(folders).reverse();
  }
  return result;
}

/** How many entries of a scope are files no view shows, as their formats are unsupported. */
export function countUnsupported({ kinds }: ScopeOrder): number {
  let count = 0;
  // A plain loop, as in `narrow`: a scope can hold millions of entries.
  for (const kind of kinds) {
    if (kind === KIND_CODES.file) {
      count += 1;
    }
  }
  return count;
}
