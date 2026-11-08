import { KIND_CODES } from '#photos/catalog/data/codes';
import { type CatalogDatabase, isIn, preparedOnce } from '#photos/catalog/data/database';
import { atPlaceholderId } from '#photos/catalog/data/items';
import { every, inScope, readFrom, type Scope } from '#photos/catalog/data/scope';
import { items, itemTags } from '#photos/index-schema';
import type { PhotoExif } from '@prism/shared';
import { eq, gt, sql } from 'drizzle-orm';

/** A photo whose details are wanted. */
export interface UnreadPhoto {
  item: number;
  id: string;
}

/**
 * A photo whose details have yet to be read. Its values are literals, as SQLite reads a
 * partial index such as `items_unread` only for a condition it can tell implies the index's.
 */
const isUnread = sql`${items.kind} = ${sql.raw(String(KIND_CODES.image))} AND ${items.exifRead} = 0`;

/** A file with the size and modification time of the placeholders, which its details were read at. */
const isAsRead = sql`${items.size} IS ${sql.placeholder('size')}
  AND ${items.modifiedMs} IS ${sql.placeholder('modifiedMs')}`;

const setDetailsQuery = preparedOnce((db) =>
  db
    .update(items)
    .set({
      camera: sql.placeholder('camera'),
      exif: sql.placeholder('exif'),
      exifRead: 1,
      lens: sql.placeholder('lens'),
      takenMs: sql.placeholder('takenMs'),
    })
    .where(every(atPlaceholderId, eq(items.kind, KIND_CODES.image), isAsRead))
    .prepare(),
);

/**
 * Stores the details of the photo at `id`, if its file still has the size and modification
 * time they were read at. Returns whether it did.
 */
export function setDetails(
  db: CatalogDatabase,
  library: number,
  photo: { id: string; size: number; modifiedMs: number; exif: PhotoExif },
): boolean {
  const { changes } = setDetailsQuery(db).run({
    camera: photo.exif.camera ?? null,
    exif: JSON.stringify(photo.exif),
    id: photo.id,
    lens: photo.exif.lens ?? null,
    library,
    modifiedMs: photo.modifiedMs,
    size: photo.size,
    takenMs: photo.exif.takenMs ?? null,
  });
  return Number(changes) > 0;
}

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

/** How many photos of `scope` have yet to have their details read. */
export function countUnread(db: CatalogDatabase, library: number, scope: Scope): number {
  const row = db.get<{ count: number }>(sql`
    SELECT count(*) AS count FROM ${readFrom(scope, 'items_unread')}
    WHERE ${inScope(library, scope)} AND ${isUnread}`);
  return row?.count ?? 0;
}

/** Of the entries numbered `numbers`, the photos whose details have yet to be read. */
export function unreadAmong(db: CatalogDatabase, numbers: number[]): UnreadPhoto[] {
  return db
    .select({ id: items.id, item: items.item })
    .from(items)
    .where(every(isIn(items.item, numbers), isUnread))
    .all();
}

/** Up to `limit` photos of the library whose details have yet to be read, numbered after `after`. */
export function unreadAfter(
  db: CatalogDatabase,
  library: number,
  after: number,
  limit: number,
): UnreadPhoto[] {
  return db.all<UnreadPhoto>(sql`
    SELECT ${items.item}, ${items.id} FROM ${items} INDEXED BY items_unread
    WHERE ${every(eq(items.library, library), isUnread, gt(items.item, after))}
    ORDER BY ${items.item} LIMIT ${limit}`);
}
