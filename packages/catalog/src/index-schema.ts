import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

// Columns are listed in the order the tables hold them, which is the order migrations make them.
/* oxlint-disable sort-keys */

/**
 * The photo index's tables. `drizzle-kit generate` compares this with the last migration and
 * writes the next one into `migrations/`; see `docs/development.md`. Column names are spelled
 * out, as they are what the SQL in the data layer uses.
 */

/** Photos' EXIF details, by path, kept while the file has the size and time they were read at. */
export const exif = sqliteTable(
  'exif',
  {
    path: text('path').primaryKey(),
    /** The file's place on disk, which a rename keeps. */
    identity: text('identity'),
    size: integer('size').notNull(),
    modifiedMs: real('modified_ms').notNull(),
    exif: text('exif').notNull(),
    usedMs: integer('used_ms').notNull(),
  },
  (table) => [index('exif_identity').on(table.identity)],
);

/** Each library the catalog holds, by the canonical path of the folder opened. */
export const libraries = sqliteTable('libraries', {
  library: integer('library').primaryKey(),
  root: text('root').notNull().unique(),
  usedMs: integer('used_ms').notNull(),
});

/**
 * The catalog: every entry of every library, so views are queries. `item` never repeats, so an
 * order a view holds never names another entry by mistake. `grp` is 0 for folders, so they
 * come first in every sort index.
 */
export const items = sqliteTable(
  'items',
  {
    item: integer('item').primaryKey({ autoIncrement: true }),
    library: integer('library').notNull(),
    id: text('id').notNull(),
    parentId: text('parent_id').notNull(),
    name: text('name').notNull(),
    /** Sorts as people read names; see `nameKey`. */
    nameKey: text('name_key').notNull(),
    /** What a search matches. */
    nameFold: text('name_fold').notNull(),
    /** 0 folder, 1 photo, 2 video, 3 any other file. */
    kind: integer('kind').notNull(),
    grp: integer('grp').notNull(),
    size: integer('size'),
    createdMs: real('created_ms'),
    modifiedMs: real('modified_ms'),
    accessedMs: real('accessed_ms'),
    /** 1 once the photo's details were read, while it had this size and time. */
    exifRead: integer('exif_read').notNull().default(0),
    takenMs: real('taken_ms'),
    camera: text('camera'),
    lens: text('lens'),
    exif: text('exif'),
    /** A photo's rating, read from its file with its details; see `ratesInFile`. */
    rating: integer('rating'),
    /**
     * The file's inode, which names its thumbnail, `'0'` where the disk reports none; `NULL`
     * until the folder is read by a build that keeps it. Text, as a share's can pass what an
     * integer read back holds exactly.
     */
    inode: text('inode'),
    /**
     * A folder's tile, kept by the writer as what is inside changes; see `folder-summaries.ts`.
     * `NULL` on every row until the writer works it out, as on rows a build before them wrote,
     * where `[]` and 0 say the folder has none.
     */
    hasEntries: integer('has_entries'),
    hasSubfolders: integer('has_subfolders'),
    /**
     * The numbers of up to four entries to show as the folder's cover, as JSON: its own photos
     * and videos, or those of the first folder inside it with any. Numbers rather than copies,
     * so a cover is read as its file is now, with its rating.
     */
    covers: text('covers'),
  },
  (table) => [
    uniqueIndex('items_id').on(table.library, table.id),
    index('items_parent').on(table.library, table.parentId),
    index('items_name').on(table.library, table.grp, table.nameKey, table.kind),
    index('items_taken').on(
      table.library,
      table.grp,
      sql`coalesce(${table.takenMs}, ${table.modifiedMs})`,
      table.nameKey,
      table.kind,
    ),
    index('items_kind').on(table.library, table.kind),
    index('items_unread')
      .on(table.library, table.item)
      .where(sql`${table.kind} = 1 AND ${table.exifRead} = 0`),
    index('items_camera')
      .on(table.library, table.camera)
      .where(sql`${table.camera} IS NOT NULL`),
    index('items_lens')
      .on(table.library, table.lens)
      .where(sql`${table.lens} IS NOT NULL`),
    index('items_rating')
      .on(table.library, table.rating)
      .where(sql`${table.rating} IS NOT NULL`),
    // The folders with covers to lend the folder holding them, by name, which the writer finds
    // the first of without reading the rest.
    index('items_lenders')
      .on(table.library, table.parentId, table.nameKey)
      .where(sql`${table.kind} = 0 AND ${table.covers} IS NOT NULL AND ${table.covers} <> '[]'`),
    // The folders whose tiles the writer has yet to work out, which it fills in the background.
    index('items_uncovered')
      .on(table.library, table.item)
      .where(sql`${table.kind} = 0 AND ${table.covers} IS NULL`),
  ],
);

/** Photos' tags, a row each, so counting and filtering by them are lookups. */
export const itemTags = sqliteTable(
  'item_tags',
  {
    library: integer('library').notNull(),
    tag: text('tag').notNull(),
    item: integer('item').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.library, table.tag, table.item] }),
    index('item_tags_item').on(table.item),
  ],
);

/** Folders the indexer read to the end, whose rows are all they hold. */
export const indexedFolders = sqliteTable(
  'indexed_folders',
  {
    library: integer('library').notNull(),
    directoryId: text('directory_id').notNull(),
  },
  (table) => [primaryKey({ columns: [table.library, table.directoryId] })],
);
