import type { CatalogDatabase } from '#database/catalog-database';
import { entries } from '#database/photo-index/schema';
import { KIND_CODES, nameFold } from '#repositories/queries/codes';
import { inScope, readFrom, type Scope } from '#repositories/queries/scope';
import { isIn, matchAll, parseNumbers } from '#repositories/queries/sql-helpers';
import type { Rating } from '@prism/shared';
import { eq, inArray, isNotNull, sql } from 'drizzle-orm';

// A scope is the folders a view or query covers: one folder, or it and every folder inside it.

/** The details views filter by that have a column, and an index, of their own. */
export type DetailField = 'camera' | 'lens';

/** How many entries have one value of a field. */
export interface ValueCount {
  value: string;
  count: number;
}

const DETAIL_COLUMNS = { camera: entries.camera, lens: entries.lens };

/** The entries of `scope` whose `field` is one of `values`. */
export function entriesWithValues(
  db: CatalogDatabase,
  library: number,
  scope: Scope,
  field: DetailField,
  values: string[],
): number[] {
  const row = db.get<{ entries: string }>(sql`
    SELECT json_group_array(${entries.entry}) AS entries FROM ${readFrom(scope, `entries_${field}`)}
    WHERE ${matchAll(inScope(library, scope), isIn(DETAIL_COLUMNS[field], values))}`);
  return parseNumbers(row?.entries);
}

/** The entries of `scope` whose names contain `text`, which is folded as names are. */
export function entriesNamed(
  db: CatalogDatabase,
  library: number,
  scope: Scope,
  text: string,
): number[] {
  const row = db.get<{ entries: string }>(sql`
    SELECT json_group_array(${entries.entry}) AS entries FROM ${readFrom(scope)}
    WHERE ${inScope(library, scope)} AND instr(${entries.nameFold}, ${nameFold(text)}) > 0`);
  return parseNumbers(row?.entries);
}

/** How many entries of `scope` have each value of `field`. */
export function countValues(
  db: CatalogDatabase,
  library: number,
  scope: Scope,
  field: DetailField,
): ValueCount[] {
  const column = DETAIL_COLUMNS[field];
  return db.all<ValueCount>(sql`
    SELECT ${column} AS value, count(*) AS count FROM ${readFrom(scope, `entries_${field}`)}
    WHERE ${matchAll(inScope(library, scope), isNotNull(column))} GROUP BY ${column}`);
}

/** How many entries of `scope` can be rated: its folders, photos and videos. */
export function countRateable(db: CatalogDatabase, library: number, scope: Scope): number {
  const rateable = [KIND_CODES.directory, KIND_CODES.image, KIND_CODES.video];
  const row = db.get<{ count: number }>(sql`
    SELECT count(*) AS count FROM ${readFrom(scope, 'entries_kind')}
    WHERE ${matchAll(inScope(library, scope), inArray(entries.kind, rateable))}`);
  return row?.count ?? 0;
}

/** How many photos, and how many videos, `scope` holds, by kind code. */
export function countMedia(
  db: CatalogDatabase,
  library: number,
  scope: Scope,
): { kind: number; count: number }[] {
  const media = [KIND_CODES.image, KIND_CODES.video];
  return db.all<{ kind: number; count: number }>(sql`
    SELECT ${entries.kind} AS kind, count(*) AS count FROM ${readFrom(scope, 'entries_kind')}
    WHERE ${matchAll(inScope(library, scope), inArray(entries.kind, media))} GROUP BY ${entries.kind}`);
}

/** The photos rated in their files, in any scope: views filter them to their own. */
export function entryRatings(
  db: CatalogDatabase,
  library: number,
): { entry: number; rating: Rating }[] {
  return db.all<{ entry: number; rating: Rating }>(sql`
    SELECT ${entries.entry} AS entry, ${entries.rating} AS rating FROM ${entries} INDEXED BY entries_rating
    WHERE ${matchAll(eq(entries.library, library), isNotNull(entries.rating))}`);
}

/** How many photos of `scope` their files rate each number of stars. */
export function countRatings(
  db: CatalogDatabase,
  library: number,
  scope: Scope,
): { rating: Rating; count: number }[] {
  return db.all<{ rating: Rating; count: number }>(sql`
    SELECT ${entries.rating} AS rating, count(*) AS count FROM ${readFrom(scope, 'entries_rating')}
    WHERE ${matchAll(inScope(library, scope), isNotNull(entries.rating))} GROUP BY ${entries.rating}`);
}
