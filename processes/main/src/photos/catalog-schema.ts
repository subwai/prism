import type { PhotoEntry } from '@prism/shared';
import type { DatabaseSync } from 'node:sqlite';

// Items kept of the libraries not being opened, least recently used dropped first. A row and
// its index entries take about 400 bytes, so this keeps the index to a couple of gigabytes.
const MAX_OTHER_ITEMS = 5_000_000;

/** Entry kinds as the catalog stores them; folders are 0, so they come first. */
export const KIND_CODES: Record<PhotoEntry['kind'], number> = {
  directory: 0,
  file: 3,
  image: 1,
  video: 2,
};
export const KINDS: PhotoEntry['kind'][] = ['directory', 'image', 'video', 'file'];

/** Digit runs longer than this many digits sort by their digits rather than their value. */
const MAX_NUMBER_DIGITS = 99;

/**
 * A key that sorts names as `Intl.Collator` with `numeric` and `base` sensitivity does, closely
 * enough, by plain comparison: case and accents folded, and each run of digits led by its
 * length, so "IMG_9" comes before "IMG_10". `node:sqlite` cannot register a collation, so the
 * catalog stores this instead.
 */
export function nameKey(name: string): string {
  return name
    .normalize('NFKD')
    .replaceAll(/\p{M}/gu, '')
    .toLocaleLowerCase()
    .replaceAll(/\d+/gu, (digits) => {
      const value = digits.replace(/^0+(?=\d)/u, '');
      const length = Math.min(value.length, MAX_NUMBER_DIGITS);
      return `${String(length).padStart(2, '0')}${value}`;
    });
}

/** What a search matches a name against: the name as `toLocaleLowerCase` gives it. */
export function nameFold(name: string): string {
  return name.toLocaleLowerCase();
}

// A file that changed kind, size or modification time since its details were read.
const UNCHANGED =
  '(kind IS excluded.kind AND size IS excluded.size AND modified_ms IS excluded.modified_ms)';

/** Adds an entry, or updates it, dropping its details if its file changed since. */
export const UPSERT = `
  INSERT INTO items (library, id, parent_id, name, name_key, name_fold, kind, grp, size,
    created_ms, modified_ms, accessed_ms)
  VALUES (:library, :id, :parent, :name, :key, :fold, :kind, :grp, :size, :created, :modified,
    :accessed)
  ON CONFLICT (library, id) DO UPDATE SET
    parent_id = excluded.parent_id,
    name = excluded.name,
    name_key = excluded.name_key,
    name_fold = excluded.name_fold,
    kind = excluded.kind,
    grp = excluded.grp,
    exif_read = iif(${UNCHANGED}, exif_read, 0),
    taken_ms = iif(${UNCHANGED}, taken_ms, NULL),
    camera = iif(${UNCHANGED}, camera, NULL),
    lens = iif(${UNCHANGED}, lens, NULL),
    exif = iif(${UNCHANGED}, exif, NULL),
    size = excluded.size,
    created_ms = excluded.created_ms,
    modified_ms = excluded.modified_ms,
    accessed_ms = excluded.accessed_ms
  RETURNING item, kind, exif_read`;

/** Runs `write` in a transaction. */
export function transaction(database: DatabaseSync, write: () => void) {
  database.exec('BEGIN IMMEDIATE');
  try {
    write();
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

/** Drops the libraries used longest ago, past the budget of items kept of those not `kept`. */
export function pruneCatalog(database: DatabaseSync, kept: string, budget = MAX_OTHER_ITEMS): void {
  const libraries = database
    .prepare('SELECT library FROM libraries WHERE root <> ? ORDER BY used_ms DESC')
    .all(kept) as { library: number }[];
  const count = database.prepare('SELECT count(*) AS count FROM items WHERE library = ?');
  const dropped: number[] = [];
  let total = 0;
  for (const { library } of libraries) {
    total += (count.get(library) as { count: number }).count;
    if (total > budget) {
      dropped.push(library);
    }
  }
  if (dropped.length === 0) {
    return;
  }
  transaction(database, () => {
    for (const table of ['item_tags', 'items', 'indexed_folders', 'libraries']) {
      const drop = database.prepare(`DELETE FROM ${table} WHERE library = ?`);
      for (const library of dropped) {
        drop.run(library);
      }
    }
  });
}
