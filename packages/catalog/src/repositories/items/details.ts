import { type CatalogDatabase, preparedOnce } from '#database/catalog-database';
import { DETAILS_CODES, KIND_CODES } from '#repositories/queries/codes';
import { atPlaceholderId, entryId, parentPath, placeOf } from '#repositories/queries/entry-ids';
import { inScope, readFrom, type Scope } from '#repositories/queries/scope';
import { isIn, matchAll } from '#repositories/queries/sql-helpers';
import { items, itemTags } from '#schema/photo-index';
import type { PhotoExif } from '@prism/shared';
import { eq, gt, ne, sql } from 'drizzle-orm';

/** A photo whose details are wanted, with the size and modification time the catalog lists. */
export interface UnreadPhoto {
  item: number;
  id: string;
  size: number | null;
  modifiedMs: number | null;
}

/** A photo whose details could not be read, while its file had this size and modification time. */
export interface UnreadableFile {
  id: string;
  size: number | null;
  modifiedMs: number | null;
}

/**
 * A photo whose details have yet to be read. Its values are literals, as SQLite reads a
 * partial index such as `items_unread` only for a condition it can tell implies the index's.
 */
const isUnread = sql`${items.kind} = ${sql.raw(String(KIND_CODES.image))}
  AND ${items.exifRead} = ${sql.raw(String(DETAILS_CODES.unread))}`;

/** A file with the size and modification time of the placeholders, which its details were read at. */
const isAsRead = sql`${items.size} IS ${sql.placeholder('size')}
  AND ${items.modifiedMs} IS ${sql.placeholder('modifiedMs')}`;

const setDetailsQuery = preparedOnce((db) =>
  db
    .update(items)
    .set({
      camera: sql.placeholder('camera'),
      exif: sql.placeholder('exif'),
      exifRead: DETAILS_CODES.read,
      lens: sql.placeholder('lens'),
      rating: sql.placeholder('rating'),
      takenMs: sql.placeholder('takenMs'),
    })
    .where(matchAll(atPlaceholderId, eq(items.kind, KIND_CODES.image), isAsRead))
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
    ...placeOf(photo.id),
    lens: photo.exif.lens ?? null,
    library,
    modifiedMs: photo.modifiedMs,
    rating: photo.exif.rating ?? null,
    size: photo.size,
    takenMs: photo.exif.takenMs ?? null,
  });
  return Number(changes) > 0;
}

const setUnreadableQuery = preparedOnce((db) =>
  db
    .update(items)
    .set({ exifRead: DETAILS_CODES.unreadable })
    .where(matchAll(atPlaceholderId, isUnread, isAsRead))
    .prepare(),
);

/**
 * Marks the photo at `id` as tried, its details unreadable, if they are still to read and its
 * file still has the size and modification time they could not be read at, so it counts as done
 * until the file changes. Returns whether it did.
 */
export function setUnreadable(db: CatalogDatabase, library: number, file: UnreadableFile): boolean {
  const { changes } = setUnreadableQuery(db).run({
    ...placeOf(file.id),
    library,
    modifiedMs: file.modifiedMs,
    size: file.size,
  });
  return Number(changes) > 0;
}

const detailsAtQuery = preparedOnce((db) =>
  db
    .select({ exif: items.exif })
    .from(items)
    .where(
      matchAll(
        atPlaceholderId,
        eq(items.kind, KIND_CODES.image),
        eq(items.exifRead, DETAILS_CODES.read),
        isAsRead,
      ),
    )
    .prepare(),
);

/**
 * The details stored of the photo at `id` in `library`, if they were read while its file had
 * this size and modification time.
 */
export function detailsAt(
  db: CatalogDatabase,
  library: number,
  photo: { id: string; size: number; modifiedMs: number },
): PhotoExif | undefined {
  const row = detailsAtQuery(db).get({
    ...placeOf(photo.id),
    library,
    modifiedMs: photo.modifiedMs,
    size: photo.size,
  });
  return row?.exif ? (JSON.parse(row.exif) as PhotoExif) : undefined;
}

/** How many photos of `scope` have yet to have their details read. */
export function countUnread(db: CatalogDatabase, library: number, scope: Scope): number {
  const row = db.get<{ count: number }>(sql`
    SELECT count(*) AS count FROM ${readFrom(scope, 'items_unread')}
    WHERE ${inScope(library, scope)} AND ${isUnread}`);
  return row?.count ?? 0;
}

const unreadColumns = {
  item: items.item,
  modifiedMs: items.modifiedMs,
  name: items.name,
  parentId: parentPath,
  size: items.size,
};

type UnreadRow = Omit<UnreadPhoto, 'id'> & { parentId: string; name: string };

function unreadPhoto({ parentId, name, ...row }: UnreadRow): UnreadPhoto {
  return { ...row, id: entryId(parentId, name) };
}

/** Of the entries numbered `numbers`, the photos whose details have yet to be read. */
export function unreadPhotosOf(db: CatalogDatabase, numbers: number[]): UnreadPhoto[] {
  return db
    .select(unreadColumns)
    .from(items)
    .where(matchAll(isIn(items.item, numbers), isUnread))
    .all()
    .map((row) => unreadPhoto(row));
}

/** Up to `limit` photos of the library whose details have yet to be read, numbered after `after`. */
export function unreadAfter(
  db: CatalogDatabase,
  library: number,
  after: number,
  limit: number,
): UnreadPhoto[] {
  return db
    .all<UnreadRow>(sql`
      SELECT ${items.item} AS item, ${parentPath} AS parentId, ${items.name} AS name,
        ${items.size} AS size, ${items.modifiedMs} AS modifiedMs
      FROM ${items} INDEXED BY items_unread
      WHERE ${matchAll(eq(items.library, library), isUnread, gt(items.item, after))}
      ORDER BY ${items.item} LIMIT ${limit}`)
    .map((row) => unreadPhoto(row));
}

/**
 * Forgets the details of every photo of every library, and which could not be read, so each is
 * read again.
 */
export function forgetAllDetails(db: CatalogDatabase): void {
  db.delete(itemTags).run();
  db.update(items)
    .set({
      camera: null,
      exif: null,
      exifRead: DETAILS_CODES.unread,
      lens: null,
      rating: null,
      takenMs: null,
    })
    .where(ne(items.exifRead, DETAILS_CODES.unread))
    .run();
}
