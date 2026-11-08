import type { PhotoEntry } from '@prism/shared';
import type { DatabaseSync } from 'node:sqlite';

// Items kept of the libraries not being opened, least recently used dropped first. A row and
// its index entries take about 400 bytes, so this keeps the index to a couple of gigabytes.
const MAX_OTHER_ITEMS = 5_000_000;

/**
 * The catalog: every entry of every library the app has read, one row each, so views are
 * queries rather than lists the window holds. `PhotoIndex` creates it with its own tables.
 *
 * - `item` never repeats, even after a row goes, so an order a view holds never names another
 *   entry by mistake.
 * - `grp` puts folders first, and leads each sort index so a sort reads straight from it.
 * - `name_key` sorts names as people read them; see `nameKey`. `name_fold` is what a search
 *   matches.
 * - `exif_read` says photos' details were read while the file was as `size` and
 *   `modified_ms` say. Listing a file that changed sets it back, which drops its tags.
 * - `indexed_folders` holds the folders read to the end, whose rows are all their entries.
 */
export const CATALOG_SCHEMA = `
  CREATE TABLE libraries (
    library INTEGER PRIMARY KEY,
    root TEXT NOT NULL UNIQUE,
    used_ms INTEGER NOT NULL
  );
  CREATE TABLE items (
    item INTEGER PRIMARY KEY AUTOINCREMENT,
    library INTEGER NOT NULL,
    id TEXT NOT NULL,
    parent_id TEXT NOT NULL,
    name TEXT NOT NULL,
    name_key TEXT NOT NULL,
    name_fold TEXT NOT NULL,
    kind INTEGER NOT NULL,
    grp INTEGER NOT NULL,
    size INTEGER,
    created_ms REAL,
    modified_ms REAL,
    accessed_ms REAL,
    exif_read INTEGER NOT NULL DEFAULT 0,
    taken_ms REAL,
    camera TEXT,
    lens TEXT,
    exif TEXT
  );
  CREATE UNIQUE INDEX items_id ON items (library, id);
  CREATE INDEX items_parent ON items (library, parent_id);
  CREATE INDEX items_name ON items (library, grp, name_key, kind);
  CREATE INDEX items_taken ON items (library, grp, coalesce(taken_ms, modified_ms), name_key, kind);
  CREATE INDEX items_kind ON items (library, kind);
  CREATE INDEX items_unread ON items (library, item) WHERE kind = 1 AND exif_read = 0;
  CREATE INDEX items_camera ON items (library, camera) WHERE camera IS NOT NULL;
  CREATE INDEX items_lens ON items (library, lens) WHERE lens IS NOT NULL;
  CREATE TABLE item_tags (
    library INTEGER NOT NULL,
    tag TEXT NOT NULL,
    item INTEGER NOT NULL,
    PRIMARY KEY (library, tag, item)
  ) WITHOUT ROWID;
  CREATE INDEX item_tags_item ON item_tags (item);
  CREATE TABLE indexed_folders (
    library INTEGER NOT NULL,
    directory_id TEXT NOT NULL,
    PRIMARY KEY (library, directory_id)
  ) WITHOUT ROWID;
  CREATE TRIGGER items_deleted AFTER DELETE ON items BEGIN
    DELETE FROM item_tags WHERE item = old.item;
  END;
  CREATE TRIGGER items_unread AFTER UPDATE OF exif_read ON items
    WHEN new.exif_read = 0 AND old.exif_read <> 0 BEGIN
    DELETE FROM item_tags WHERE item = old.item;
  END;
`;

/** The tables `CATALOG_SCHEMA` makes, which a schema of another version drops. */
export const CATALOG_TABLES = ['item_tags', 'indexed_folders', 'items', 'libraries'];

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
