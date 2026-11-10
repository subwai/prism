import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// Columns are listed in the order the tables hold them, which is the order migrations make them.
/* oxlint-disable sort-keys */

/**
 * The ratings file's tables. Unlike the photo index, which is a cache, they are the only copy of
 * what they hold, so they live in a file of their own that nothing ever starts afresh.
 * `drizzle-kit generate --config drizzle-ratings.config.ts` writes their migrations into
 * `ratings-migrations/`; see `docs/development.md`.
 */

/**
 * The ratings of entries that keep none in a file of their own, such as folders and videos, by
 * absolute path, across libraries. Photos keep theirs in their files; see `ratesInFile`.
 */
export const ratings = sqliteTable('ratings', {
  path: text('path').primaryKey(),
  rating: integer('rating').notNull(),
  ratedMs: integer('rated_ms').notNull(),
});
