import { type CatalogDatabase, excluded, isIn } from '#data/database';
import { every } from '#data/scope';
import { ratings } from '#ratings-schema';
import type { Rating } from '@prism/shared';
import { eq, gte, lt, or, type SQL, sql } from 'drizzle-orm';
import path from 'node:path';

/**
 * The ratings file's connection, as the data layer queries it: these functions each make one
 * query of it, taking the connection and the paths they ask about.
 */
export type RatingsDatabase = CatalogDatabase;

/** A rating the ratings file keeps, of the entry at `path`. */
export interface StoredRating {
  path: string;
  rating: Rating;
}

// The character after the separator, which ends the range of paths inside a folder.
const AFTER_SEPARATOR = String.fromCodePoint((path.sep.codePointAt(0) ?? 0) + 1);

/** `folder` and every path inside it, as a range of the primary key rather than a scan. */
function atOrInside(folder: string): SQL {
  return (
    or(
      eq(ratings.path, folder),
      every(
        gte(ratings.path, `${folder}${path.sep}`),
        lt(ratings.path, `${folder}${AFTER_SEPARATOR}`),
      ),
    ) ?? sql`0`
  );
}

/** The ratings kept of `folder` and everything inside it. */
export function ratingsInside(db: RatingsDatabase, folder: string): StoredRating[] {
  return db
    .select({ path: ratings.path, rating: ratings.rating })
    .from(ratings)
    .where(atOrInside(folder))
    .all() as StoredRating[];
}

/** The ratings kept of the entries at `paths`, leaving out those it has none of. */
export function ratingsAt(db: RatingsDatabase, paths: string[]): StoredRating[] {
  return db
    .select({ path: ratings.path, rating: ratings.rating })
    .from(ratings)
    .where(isIn(ratings.path, paths))
    .all() as StoredRating[];
}

/** Keeps `rating` as the rating of the entry at `path`, rated at `ratedMs`. */
export function storeRating(db: RatingsDatabase, stored: StoredRating & { ratedMs: number }): void {
  db.insert(ratings)
    .values(stored)
    .onConflictDoUpdate({
      set: { ratedMs: excluded(ratings.ratedMs), rating: excluded(ratings.rating) },
      target: ratings.path,
    })
    .run();
}

/** Forgets the rating of the entry at `file`. */
export function unstoreRating(db: RatingsDatabase, file: string): void {
  db.delete(ratings).where(eq(ratings.path, file)).run();
}

/**
 * Moves the ratings of the entry at `from`, and of everything inside it, to `to`, as a rename
 * does, replacing any kept of what was there before.
 */
export function moveRatings(db: RatingsDatabase, from: string, to: string): void {
  db.run(sql`
    UPDATE OR REPLACE ${ratings}
    SET ${sql.identifier(ratings.path.name)} = ${to} || substr(${ratings.path}, ${from.length + 1})
    WHERE ${atOrInside(from)}`);
}
