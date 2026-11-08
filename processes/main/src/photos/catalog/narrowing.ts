import { KIND_CODES } from '#photos/catalog/data/codes';
import type { CatalogDatabase } from '#photos/catalog/data/database';
import { allTags, having, maxItem, named, tagged } from '#photos/catalog/data/filters';
import type { ScopeOrder } from '#photos/catalog/data/orders';
import type { Scope } from '#photos/catalog/data/scope';
import { FILTER_FIELDS, FORMATS, type PhotoEntry, type ViewSpec } from '@prism/shared';

type Kind = PhotoEntry['kind'];

// The kinds each view shows.
const SHOWN: Record<ViewSpec['show'], Kind[]> = {
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
  // Folders have none of the values filters choose.
  if (FILTER_FIELDS.some((field) => filter[field].length > 0)) {
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
): Uint8Array[] {
  const size = maxItem(db);
  const sets: Uint8Array[] = [];
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
  for (const [index, item] of items.entries()) {
    const kind = kinds[index] ?? KIND_CODES.file;
    if (shown[kind] !== 1 || sets.some((set) => set[item] !== 1)) {
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
