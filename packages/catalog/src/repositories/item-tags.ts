import { type CatalogDatabase, preparedOnce } from '#database/catalog-database';
import { items, itemTags } from '#database/photo-index/schema';
import type { ValueCount } from '#repositories/items/filters';
import { inScope, isWholeLibrary, readFrom, type Scope } from '#repositories/queries/scope';
import { isIn, matchAll, parseNumbers } from '#repositories/queries/sql-helpers';
import { eq, inArray, sql } from 'drizzle-orm';

const deleteTagsQuery = preparedOnce((db) =>
  db
    .delete(itemTags)
    .where(eq(itemTags.item, sql.placeholder('item')))
    .prepare(),
);

const insertTagQuery = preparedOnce((db) =>
  db
    .insert(itemTags)
    .values({
      item: sql.placeholder('item'),
      library: sql.placeholder('library'),
      tag: sql.placeholder('tag'),
    })
    .onConflictDoNothing()
    .prepare(),
);

/** Replaces the tags of the photo numbered `item`. */
export function setTags(db: CatalogDatabase, library: number, item: number, tags: string[]): void {
  deleteTagsQuery(db).run({ item });
  for (const tag of tags) {
    insertTagQuery(db).run({ item, library, tag });
  }
}

/** The photos tagged with any of `tags`, in any scope: views narrow them to their own. */
export function photosTagged(db: CatalogDatabase, library: number, tags: string[]): number[] {
  const row = db.get<{ items: string }>(sql`
    SELECT json_group_array(${itemTags.item}) AS items FROM ${itemTags}
    WHERE ${matchAll(eq(itemTags.library, library), isIn(itemTags.tag, tags))}`);
  return parseNumbers(row?.items);
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

/** Deletes the tags of every photo of `library`. */
export function deleteTagsOfLibrary(db: CatalogDatabase, library: number): void {
  db.delete(itemTags).where(eq(itemTags.library, library)).run();
}
