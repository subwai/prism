import { KIND_CODES, nameFold } from '#photos/catalog/data/codes';
import { type CatalogDatabase, isIn, numbers } from '#photos/catalog/data/database';
import { every, inScope, isWholeLibrary, readFrom, type Scope } from '#photos/catalog/data/scope';
import { items, itemTags } from '#photos/catalog/index-schema';
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
export function maxItem(db: CatalogDatabase): number {
  const row = db.get<{ seq: number }>(sql`SELECT seq FROM sqlite_sequence WHERE name = ${'items'}`);
  return row?.seq ?? 0;
}

/** The entries of `scope` whose `field` is one of `values`. */
export function having(
  db: CatalogDatabase,
  library: number,
  scope: Scope,
  field: DetailField,
  values: string[],
): number[] {
  const row = db.get<{ items: string }>(sql`
    SELECT json_group_array(${items.item}) AS items FROM ${readFrom(scope, `items_${field}`)}
    WHERE ${every(inScope(library, scope), isIn(DETAIL_COLUMNS[field], values))}`);
  return numbers(row?.items);
}

/** The photos tagged with any of `tags`, in any scope: views narrow them to their own. */
export function tagged(db: CatalogDatabase, library: number, tags: string[]): number[] {
  const row = db.get<{ items: string }>(sql`
    SELECT json_group_array(${itemTags.item}) AS items FROM ${itemTags}
    WHERE ${every(eq(itemTags.library, library), isIn(itemTags.tag, tags))}`);
  return numbers(row?.items);
}

/** The entries of `scope` whose names contain `text`, which is folded as names are. */
export function named(db: CatalogDatabase, library: number, scope: Scope, text: string): number[] {
  const row = db.get<{ items: string }>(sql`
    SELECT json_group_array(${items.item}) AS items FROM ${readFrom(scope)}
    WHERE ${inScope(library, scope)} AND instr(${items.nameFold}, ${nameFold(text)}) > 0`);
  return numbers(row?.items);
}

/** Every tag in the library, to find the ones a search matches. */
export function allTags(db: CatalogDatabase, library: number): string[] {
  return db
    .selectDistinct({ tag: itemTags.tag })
    .from(itemTags)
    .where(eq(itemTags.library, library))
    .all()
    .map((row) => row.tag);
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
    WHERE ${every(inScope(library, scope), isNotNull(column))} GROUP BY ${column}`);
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
    WHERE ${every(inScope(library, scope), inArray(items.kind, media))} GROUP BY ${items.kind}`);
}

/** How many photos of `scope` have each tag. */
export function countTags(db: CatalogDatabase, library: number, scope: Scope): ValueCount[] {
  const inLibrary = isWholeLibrary(scope)
    ? eq(itemTags.library, library)
    : inArray(
        itemTags.item,
        sql`(SELECT ${items.item} FROM ${readFrom(scope)} WHERE ${inScope(library, scope)})`,
      );
  return db
    .select({ count: sql<number>`count(*)`, value: itemTags.tag })
    .from(itemTags)
    .where(inLibrary)
    .groupBy(itemTags.tag)
    .all();
}
