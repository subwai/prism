import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// Columns are listed in the order the tables hold them, which is the order migrations make them.
/* oxlint-disable sort-keys */

/**
 * The thumbnail index's tables. `drizzle-kit generate` compares this with the last migration and
 * writes the next one into `thumbnail-index-migrations/`; see `docs/development.md`. The index
 * can be made again from the cache folder, so a migration may empty it.
 */

/** Each cached thumbnail, by key: its size, and when it was last shown or made. */
export const thumbnails = sqliteTable(
  'thumbnails',
  {
    key: text('key').primaryKey(),
    size: integer('size').notNull(),
    usedMs: integer('used_ms').notNull(),
  },
  (table) => [index('thumbnails_used').on(table.usedMs)],
);

/** When the index was last made from the cache folder; empty until it has been. */
export const rebuilds = sqliteTable('rebuilds', {
  finishedMs: integer('finished_ms').notNull(),
});
