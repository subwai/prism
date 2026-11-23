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
 * out, as they are what the SQL in `repositories/` uses.
 */

/**
 * The details of photos whose rows went, as a file moved or renamed where the app did not see
 * it, or put in Trash, by the file's inode, size and modification time, so a row listing the
 * same file again takes them back rather than reading it. A trigger on `items` fills it; see
 * the removed-details migrations. Photos' details otherwise live only on their rows.
 */
export const removedDetails = sqliteTable(
  'removed_details',
  {
    /** The file's inode, which a rename keeps, without the device, which a remount changes. */
    inode: text('inode').notNull(),
    size: integer('size').notNull(),
    modifiedMs: real('modified_ms').notNull(),
    exif: text('exif').notNull(),
    removedMs: integer('removed_ms').notNull(),
  },
  (table) => [primaryKey({ columns: [table.inode, table.size, table.modifiedMs] })],
);

/** Each library the catalog holds, by the canonical path of the folder opened. */
export const libraries = sqliteTable('libraries', {
  library: integer('library').primaryKey(),
  root: text('root').notNull().unique(),
  usedMs: integer('used_ms').notNull(),
  /**
   * The tile of the library's own folder, which no folder holds, so it has no row in `items`:
   * kept here as `items` keeps every other folder's, and `NULL` until the writer works it out.
   */
  hasEntries: integer('has_entries'),
  hasSubfolders: integer('has_subfolders'),
  covers: text('covers'),
  /**
   * When the last walk that read every folder of the library in full got to the end, which each
   * launch's check does about once a week; `NULL` until one has.
   */
  fullReadMs: integer('full_read_ms'),
  /**
   * When the full read under way began, until it gets to the end; `NULL` if none is. One the
   * library closed during is taken up again from here by the next launch's check.
   */
  fullReadStartedMs: integer('full_read_started_ms'),
});

/**
 * The catalog: every entry of every library, so views are queries. `item` never repeats, so an
 * order a view holds never names another entry by mistake. `grp` is 0 for folders, so they
 * come first in every sort index. An entry is kept by its folder's number in `folders` and its
 * name, rather than by its path, which `folders` keeps once for each folder: its ID is its
 * folder's path and its name, joined; see `entryId`.
 */
export const items = sqliteTable(
  'items',
  {
    item: integer('item').primaryKey({ autoIncrement: true }),
    library: integer('library').notNull(),
    /** The `folder` of the folder the entry is in. */
    parent: integer('parent').notNull(),
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
    /**
     * 1 once the photo's details were read, while it had this size and time, and 2 if they could
     * not be read from it then; see `DETAILS_CODES`.
     */
    exifRead: integer('exif_read').notNull().default(0),
    takenMs: real('taken_ms'),
    camera: text('camera'),
    lens: text('lens'),
    exif: text('exif'),
    /** A photo's rating, read from its file with its details; see `keepsRatingInFile`. */
    rating: integer('rating'),
    /**
     * The file's inode, which names its thumbnail, `'0'` where the disk reports none; `NULL`
     * until the folder is read by a build that keeps it. Text, as a share's can pass what an
     * integer read back holds exactly.
     */
    inode: text('inode'),
    /**
     * A folder's tile, kept by the writer as what is inside changes; see `repositories/items/folder-summaries.ts`.
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
    uniqueIndex('items_entry').on(table.parent, table.name),
    // A folder's entries in the order its contents show them, and every folder's, folder by
    // folder, in the order the sort by name reads them; see `byName`.
    index('items_parent').on(table.parent, table.grp, table.nameKey, table.kind),
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
    // The few photos whose details could not be read, which the details row counts.
    index('items_unreadable')
      .on(table.library)
      .where(sql`${table.kind} = 1 AND ${table.exifRead} = 2`),
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
      .on(table.parent, table.nameKey)
      .where(sql`${table.kind} = 0 AND ${table.covers} IS NOT NULL AND ${table.covers} <> '[]'`),
  ],
);

/**
 * Each folder's path, once, for the entries in it, which `items` keeps by its number: every
 * folder of `items`, whose row `item` is, and the library's own folder, `.`, and any other an
 * entry is in, with no row of their own. Triggers keep it as `items` changes, from the folder's
 * parent's row, so a folder's path is its parent's and its name; see the folders' migration.
 */
export const folders = sqliteTable(
  'folders',
  {
    folder: integer('folder').primaryKey(),
    library: integer('library').notNull(),
    /** The folder's ID, its path inside the library's folder. */
    path: text('path').notNull(),
    /** Sorts the folder's entries by the folder they are in, as `parentKey` makes it. */
    key: text('key').notNull(),
    /** The folder's own row in `items`, if it has one. */
    item: integer('item'),
  },
  (table) => [
    uniqueIndex('folders_path').on(table.library, table.path),
    index('folders_key').on(table.library, table.key),
    index('folders_item').on(table.item),
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
    /**
     * The folder's own times and inode as its last read found them, set only by a read with
     * nothing failing; see `FolderTimes`. `NULL` if no such read was, or the last one failed.
     */
    modifiedMs: real('modified_ms'),
    changedMs: real('changed_ms'),
    inode: text('inode'),
    /**
     * When the last read of the folder to the end with nothing failing began, so a full read
     * taken up again after the library closed leaves those read since it began; `NULL` if none
     * was.
     */
    readMs: integer('read_ms'),
  },
  (table) => [primaryKey({ columns: [table.library, table.directoryId] })],
);

/**
 * Each library's tree listing, stored ready-made as text so the tree shows at once however large
 * the library is; see `tree/tree-listing.ts`. A write that changes what the tree shows deletes
 * it, and the writer builds it again once writes go quiet. `format` names the shape of the text,
 * because another build of Prism that shares the catalog may write a different shape. The table
 * keeps the name it had when listings were called skeletons, as renaming it would need a
 * migration.
 */
export const treeListings = sqliteTable('folder_skeletons', {
  library: integer('library').primaryKey(),
  format: integer('format').notNull(),
  body: text('body').notNull(),
});

/**
 * How far forgetting every photo's details has got, while one is under way: one row at most,
 * and none once it is done. The forget goes through the entries by number, a batch at a time, so
 * a forget the app quit during is carried on from here at the next launch.
 */
export const forgetProgress = sqliteTable('forget_progress', {
  /** Always 1, so the table holds one row at most. */
  id: integer('id').primaryKey(),
  /** The last entry number whose details were forgotten. */
  doneThrough: integer('done_through').notNull(),
});
