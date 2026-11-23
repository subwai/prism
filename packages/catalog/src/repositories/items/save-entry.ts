import { type CatalogDatabase, preparedOnce } from '#database/catalog-database';
import { items } from '#database/photo-index/schema';
import { folderNumber } from '#repositories/folders';
import { KIND_CODES, nameFold, nameKey } from '#repositories/queries/codes';
import { atPlaceholderId, placeOf } from '#repositories/queries/entry-ids';
import { excluded } from '#repositories/queries/sql-helpers';
import type { PhotoEntry } from '@prism/shared';
import { type Column, type SQL, sql } from 'drizzle-orm';

/**
 * An entry as a save left it: whether it is a photo whose details are still to read, and
 * whether the save changed its row, as one listed just as the catalog has it does not.
 */
export interface SavedEntry {
  item: number;
  kind: number;
  exifRead: number;
  changed: boolean;
}

/** Whether the file a save lists is as it was when its details were read. */
const unchanged = sql`(${items.kind} IS ${excluded(items.kind)}
  AND ${items.size} IS ${excluded(items.size)}
  AND ${items.modifiedMs} IS ${excluded(items.modifiedMs)})`;

/** `column` as it is if the file is unchanged, or `otherwise` as its details no longer hold. */
function ifUnchanged(column: Column, otherwise: SQL) {
  return sql`iif(${unchanged}, ${column}, ${otherwise})`;
}

/** Whether a save lists the entry otherwise than its row has it. */
const listedOtherwise = sql`NOT (${sql.join(
  [
    items.accessedMs,
    items.createdMs,
    items.grp,
    items.inode,
    items.kind,
    items.modifiedMs,
    items.nameFold,
    items.nameKey,
    items.size,
  ].map((column) => sql`${column} IS ${excluded(column)}`),
  sql` AND `,
)})`;

const saveQuery = preparedOnce((db) =>
  db
    .insert(items)
    .values({
      accessedMs: sql.placeholder('accessedMs'),
      createdMs: sql.placeholder('createdMs'),
      grp: sql.placeholder('grp'),
      inode: sql.placeholder('inode'),
      kind: sql.placeholder('kind'),
      library: sql.placeholder('library'),
      modifiedMs: sql.placeholder('modifiedMs'),
      name: sql.placeholder('name'),
      nameFold: sql.placeholder('nameFold'),
      nameKey: sql.placeholder('nameKey'),
      parent: sql.placeholder('parent'),
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
        nameFold: excluded(items.nameFold),
        nameKey: excluded(items.nameKey),
        rating: ifUnchanged(items.rating, sql`NULL`),
        size: excluded(items.size),
        takenMs: ifUnchanged(items.takenMs, sql`NULL`),
      },
      // An entry listed as it is changes no row, so a write of nothing new changes no view.
      setWhere: listedOtherwise,
      target: [items.parent, items.name],
    })
    .returning({ exifRead: items.exifRead, item: items.item, kind: items.kind })
    .prepare(),
);

const savedRowQuery = preparedOnce((db) =>
  db
    .select({ exifRead: items.exifRead, item: items.item, kind: items.kind })
    .from(items)
    .where(atPlaceholderId)
    .prepare(),
);

/** Adds `entry`, or updates it, dropping its details if its file changed since they were read. */
export function saveEntry(db: CatalogDatabase, library: number, entry: PhotoEntry): SavedEntry {
  const kind = KIND_CODES[entry.kind];
  const { metadata } = entry;
  // By its ID's folder and name, which the catalog joins into the ID it reads back.
  const { parentId, name } = placeOf(entry.id);
  const [row] = saveQuery(db).all({
    accessedMs: metadata?.accessedMs ?? null,
    createdMs: metadata?.createdMs ?? null,
    grp: kind === KIND_CODES.directory ? 0 : 1,
    inode: metadata?.inode ?? null,
    kind,
    library,
    modifiedMs: metadata?.modifiedMs ?? null,
    name,
    nameFold: nameFold(name),
    nameKey: nameKey(name),
    parent: folderNumber(db, library, parentId),
    size: metadata?.size ?? null,
  });
  if (row) {
    return { ...row, changed: true };
  }
  // A save that updates nothing returns nothing.
  const kept = savedRowQuery(db).get({ library, name, parentId });
  if (!kept) {
    throw new Error('The catalog returned no row for a save.');
  }
  return { ...kept, changed: false };
}
