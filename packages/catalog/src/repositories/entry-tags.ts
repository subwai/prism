import { type CatalogDatabase, preparedOnce } from '#database/catalog-database';
import { entries, entryTags } from '#database/photo-index/schema';
import type { ValueCount } from '#repositories/entries/filters';
import { inScope, isWholeLibrary, readFrom, type Scope } from '#repositories/queries/scope';
import { isIn, matchAll, parseNumbers } from '#repositories/queries/sql-helpers';
import { eq, gt, inArray, lte, sql } from 'drizzle-orm';

// A scope is the folders a view or query covers: one folder, or it and every folder inside it.

const deleteTagsQuery = preparedOnce((db) =>
  db
    .delete(entryTags)
    .where(eq(entryTags.entry, sql.placeholder('entry')))
    .prepare(),
);

const insertTagQuery = preparedOnce((db) =>
  db
    .insert(entryTags)
    .values({
      entry: sql.placeholder('entry'),
      library: sql.placeholder('library'),
      tag: sql.placeholder('tag'),
    })
    .onConflictDoNothing()
    .prepare(),
);

/** Replaces the tags of the photo numbered `entry`. */
export function setTags(db: CatalogDatabase, library: number, entry: number, tags: string[]): void {
  deleteTagsQuery(db).run({ entry });
  for (const tag of tags) {
    insertTagQuery(db).run({ entry, library, tag });
  }
}

/** The photos tagged with any of `tags`, in any scope: views filter them to their own. */
export function photosTagged(db: CatalogDatabase, library: number, tags: string[]): number[] {
  const row = db.get<{ entries: string }>(sql`
    SELECT json_group_array(${entryTags.entry}) AS entries FROM ${entryTags}
    WHERE ${matchAll(eq(entryTags.library, library), isIn(entryTags.tag, tags))}`);
  return parseNumbers(row?.entries);
}

/** Every tag in the library, to find the ones a search matches. */
export function allTags(db: CatalogDatabase, library: number): string[] {
  return db
    .selectDistinct({ tag: entryTags.tag })
    .from(entryTags)
    .where(eq(entryTags.library, library))
    .all()
    .map((row) => row.tag);
}

/** How many photos of `scope` have each tag. */
export function countTags(db: CatalogDatabase, library: number, scope: Scope): ValueCount[] {
  const inLibrary = isWholeLibrary(scope)
    ? eq(entryTags.library, library)
    : inArray(
        entryTags.entry,
        sql`(SELECT ${entries.entry} FROM ${readFrom(scope)} WHERE ${inScope(library, scope)})`,
      );
  return db
    .select({ count: sql<number>`count(*)`, value: entryTags.tag })
    .from(entryTags)
    .where(inLibrary)
    .groupBy(entryTags.tag)
    .all();
}

/** Deletes the tags of every photo of `library`. */
export function deleteTagsOfLibrary(db: CatalogDatabase, library: number): void {
  db.delete(entryTags).where(eq(entryTags.library, library)).run();
}

/** Deletes the tags of the photos numbered after `after`, up to `through`, in every library. */
export function deleteTagsBetween(db: CatalogDatabase, after: number, through: number): void {
  db.delete(entryTags)
    .where(matchAll(gt(entryTags.entry, after), lte(entryTags.entry, through)))
    .run();
}
