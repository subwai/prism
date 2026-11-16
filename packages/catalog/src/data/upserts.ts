import { KIND_CODES, nameFold, nameKey, parentKey } from '#data/codes';
import { type CatalogDatabase, excluded, preparedOnce } from '#data/database';
import { atPlaceholderId } from '#data/items';
import { items } from '#index-schema';
import type { PhotoEntry } from '@prism/shared';
import { type Column, type SQL, sql } from 'drizzle-orm';

/**
 * An entry as an upsert left it: whether it is a photo whose details are still to read, and
 * whether the upsert changed its row, as one listed just as the catalog has it does not.
 */
export interface UpsertedItem {
  item: number;
  kind: number;
  exifRead: number;
  changed: boolean;
}

/** Whether the file an upsert lists is as it was when its details were read. */
const unchanged = sql`(${items.kind} IS ${excluded(items.kind)}
  AND ${items.size} IS ${excluded(items.size)}
  AND ${items.modifiedMs} IS ${excluded(items.modifiedMs)})`;

/** `column` as it is if the file is unchanged, or `otherwise` as its details no longer hold. */
function ifUnchanged(column: Column, otherwise: SQL) {
  return sql`iif(${unchanged}, ${column}, ${otherwise})`;
}

/** Whether an upsert lists the entry otherwise than its row has it. */
const listedOtherwise = sql`NOT (${sql.join(
  [
    items.accessedMs,
    items.createdMs,
    items.grp,
    items.inode,
    items.kind,
    items.modifiedMs,
    items.name,
    items.nameFold,
    items.nameKey,
    items.parentId,
    items.parentKey,
    items.size,
  ].map((column) => sql`${column} IS ${excluded(column)}`),
  sql` AND `,
)})`;

const upsertQuery = preparedOnce((db) =>
  db
    .insert(items)
    .values({
      accessedMs: sql.placeholder('accessedMs'),
      createdMs: sql.placeholder('createdMs'),
      grp: sql.placeholder('grp'),
      id: sql.placeholder('id'),
      inode: sql.placeholder('inode'),
      kind: sql.placeholder('kind'),
      library: sql.placeholder('library'),
      modifiedMs: sql.placeholder('modifiedMs'),
      name: sql.placeholder('name'),
      nameFold: sql.placeholder('nameFold'),
      nameKey: sql.placeholder('nameKey'),
      parentId: sql.placeholder('parentId'),
      parentKey: sql.placeholder('parentKey'),
      size: sql.placeholder('size'),
    })
    .onConflictDoUpdate({
      // SQLite reads every value of the old row, so the order these are set in is no matter.
      set: {
        accessedMs: excluded(items.accessedMs),
        camera: ifUnchanged(items.camera, sql`NULL`),
        createdMs: excluded(items.createdMs),
        exif: ifUnchanged(items.exif, sql`NULL`),
        exifRead: ifUnchanged(items.exifRead, sql`0`),
        grp: excluded(items.grp),
        inode: excluded(items.inode),
        kind: excluded(items.kind),
        lens: ifUnchanged(items.lens, sql`NULL`),
        modifiedMs: excluded(items.modifiedMs),
        name: excluded(items.name),
        nameFold: excluded(items.nameFold),
        nameKey: excluded(items.nameKey),
        parentId: excluded(items.parentId),
        parentKey: excluded(items.parentKey),
        rating: ifUnchanged(items.rating, sql`NULL`),
        size: excluded(items.size),
        takenMs: ifUnchanged(items.takenMs, sql`NULL`),
      },
      // An entry listed as it is changes no row, so a write of nothing new changes no view.
      setWhere: listedOtherwise,
      target: [items.library, items.id],
    })
    .returning({ exifRead: items.exifRead, item: items.item, kind: items.kind })
    .prepare(),
);

const upsertedQuery = preparedOnce((db) =>
  db
    .select({ exifRead: items.exifRead, item: items.item, kind: items.kind })
    .from(items)
    .where(atPlaceholderId)
    .prepare(),
);

/** Adds `entry`, or updates it, dropping its details if its file changed since they were read. */
export function upsertItem(db: CatalogDatabase, library: number, entry: PhotoEntry): UpsertedItem {
  const kind = KIND_CODES[entry.kind];
  const { metadata } = entry;
  const [row] = upsertQuery(db).all({
    accessedMs: metadata?.accessedMs ?? null,
    createdMs: metadata?.createdMs ?? null,
    grp: kind === KIND_CODES.directory ? 0 : 1,
    id: entry.id,
    inode: metadata?.inode ?? null,
    kind,
    library,
    modifiedMs: metadata?.modifiedMs ?? null,
    name: entry.name,
    nameFold: nameFold(entry.name),
    nameKey: nameKey(entry.name),
    parentId: entry.parentId,
    parentKey: parentKey(entry.parentId),
    size: metadata?.size ?? null,
  });
  if (row) {
    return { ...row, changed: true };
  }
  // An upsert that updates nothing returns nothing.
  const kept = upsertedQuery(db).get({ id: entry.id, library });
  if (!kept) {
    throw new Error('The catalog returned no row for an upsert.');
  }
  return { ...kept, changed: false };
}
