import type { CatalogDatabase } from '#database/catalog-database';
import { items } from '#database/photo-index/schema';
import { KIND_CODES, nameFold } from '#repositories/queries/codes';
import { inScope, readFrom, type Scope } from '#repositories/queries/scope';
import { isIn, matchAll, parseNumbers } from '#repositories/queries/sql-helpers';
import type { Rating } from '@prism/shared';
import { eq, inArray, isNotNull, sql } from 'drizzle-orm';

/** The details views filter by that have a column, and an index, of their own. */
export type DetailField = 'camera' | 'lens';

/** How many entries have one value of a field. */
export interface ValueCount {
  value: string;
  count: number;
}

const DETAIL_COLUMNS = { camera: items.camera, lens: items.lens };

/** The largest entry number there has been, to size sets of them. */
export function largestItemNumber(db: CatalogDatabase): number {
  const row = db.get<{ seq: number }>(sql`SELECT seq FROM sqlite_sequence WHERE name = ${'items'}`);
  return row?.seq ?? 0;
}

/** The entries of `scope` whose `field` is one of `values`. */
export function entriesWithValues(
  db: CatalogDatabase,
  library: number,
  scope: Scope,
  field: DetailField,
  values: string[],
): number[] {
  const row = db.get<{ items: string }>(sql`
    SELECT json_group_array(${items.item}) AS items FROM ${readFrom(scope, `items_${field}`)}
    WHERE ${matchAll(inScope(library, scope), isIn(DETAIL_COLUMNS[field], values))}`);
  return parseNumbers(row?.items);
}

/** The entries of `scope` whose names contain `text`, which is folded as names are. */
export function entriesNamed(
  db: CatalogDatabase,
  library: number,
  scope: Scope,
  text: string,
): number[] {
  const row = db.get<{ items: string }>(sql`
    SELECT json_group_array(${items.item}) AS items FROM ${readFrom(scope)}
    WHERE ${inScope(library, scope)} AND instr(${items.nameFold}, ${nameFold(text)}) > 0`);
  return parseNumbers(row?.items);
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
    SELECT ${column} AS value, count(*) AS count FROM ${readFrom(scope, `items_${field}`)}
    WHERE ${matchAll(inScope(library, scope), isNotNull(column))} GROUP BY ${column}`);
}

/** How many entries of `scope` can be rated: its folders, photos and videos. */
export function countRateable(db: CatalogDatabase, library: number, scope: Scope): number {
  const rateable = [KIND_CODES.directory, KIND_CODES.image, KIND_CODES.video];
  const row = db.get<{ count: number }>(sql`
    SELECT count(*) AS count FROM ${readFrom(scope, 'items_kind')}
    WHERE ${matchAll(inScope(library, scope), inArray(items.kind, rateable))}`);
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
    SELECT ${items.kind} AS kind, count(*) AS count FROM ${readFrom(scope, 'items_kind')}
    WHERE ${matchAll(inScope(library, scope), inArray(items.kind, media))} GROUP BY ${items.kind}`);
}

/** The photos rated in their files, in any scope: views narrow them to their own. */
export function itemRatings(
  db: CatalogDatabase,
  library: number,
): { item: number; rating: Rating }[] {
  return db.all<{ item: number; rating: Rating }>(sql`
    SELECT ${items.item} AS item, ${items.rating} AS rating FROM ${items} INDEXED BY items_rating
    WHERE ${matchAll(eq(items.library, library), isNotNull(items.rating))}`);
}

/** How many photos of `scope` their files rate each number of stars. */
export function countRatings(
  db: CatalogDatabase,
  library: number,
  scope: Scope,
): { rating: Rating; count: number }[] {
  return db.all<{ rating: Rating; count: number }>(sql`
    SELECT ${items.rating} AS rating, count(*) AS count FROM ${readFrom(scope, 'items_rating')}
    WHERE ${matchAll(inScope(library, scope), isNotNull(items.rating))} GROUP BY ${items.rating}`);
}
