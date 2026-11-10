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
