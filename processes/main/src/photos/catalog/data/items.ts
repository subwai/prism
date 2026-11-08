import { KIND_CODES, kindOf, nameFold, nameKey } from '#photos/catalog/data/codes';
import { type CatalogDatabase, excluded, isIn, preparedOnce } from '#photos/catalog/data/database';
import { every, inScope, inside, readFrom } from '#photos/catalog/data/scope';
import { items } from '#photos/catalog/index-schema';
import type { PhotoEntry, PhotoExif } from '@prism/shared';
import { type Column, eq, gte, lt, type SQL, sql } from 'drizzle-orm';

/** What the catalog knows of an entry, to tell whether a listing of it is different. */
export interface KnownItem {
  id: string;
  kind: PhotoEntry['kind'];
  size: number | null;
  modifiedMs: number | null;
}

/** An entry as an upsert left it: whether it is a photo whose details are still to read. */
export interface UpsertedItem {
  item: number;
  kind: number;
  exifRead: number;
}

type Item = typeof items.$inferSelect;

const knownColumns = {
  id: items.id,
  kind: items.kind,
  modifiedMs: items.modifiedMs,
  size: items.size,
};

function knownItem(row: Pick<Item, 'id' | 'kind' | 'modifiedMs' | 'size'>): KnownItem {
  return { ...row, kind: kindOf(row.kind) };
}

/** Whether the file an upsert lists is as it was when its details were read. */
const unchanged = sql`(${items.kind} IS ${excluded(items.kind)}
  AND ${items.size} IS ${excluded(items.size)}
  AND ${items.modifiedMs} IS ${excluded(items.modifiedMs)})`;

/** `column` as it is if the file is unchanged, or `otherwise` as its details no longer hold. */
function ifUnchanged(column: Column, otherwise: SQL) {
  return sql`iif(${unchanged}, ${column}, ${otherwise})`;
}

const upsertQuery = preparedOnce((db) =>
  db
    .insert(items)
    .values({
      accessedMs: sql.placeholder('accessedMs'),
      createdMs: sql.placeholder('createdMs'),
      grp: sql.placeholder('grp'),
      id: sql.placeholder('id'),
      kind: sql.placeholder('kind'),
      library: sql.placeholder('library'),
      modifiedMs: sql.placeholder('modifiedMs'),
      name: sql.placeholder('name'),
      nameFold: sql.placeholder('nameFold'),
      nameKey: sql.placeholder('nameKey'),
      parentId: sql.placeholder('parentId'),
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
        kind: excluded(items.kind),
        lens: ifUnchanged(items.lens, sql`NULL`),
        modifiedMs: excluded(items.modifiedMs),
        name: excluded(items.name),
        nameFold: excluded(items.nameFold),
        nameKey: excluded(items.nameKey),
        parentId: excluded(items.parentId),
        size: excluded(items.size),
        takenMs: ifUnchanged(items.takenMs, sql`NULL`),
      },
      target: [items.library, items.id],
    })
    .returning({ exifRead: items.exifRead, item: items.item, kind: items.kind })
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
    kind,
    library,
    modifiedMs: metadata?.modifiedMs ?? null,
    name: entry.name,
    nameFold: nameFold(entry.name),
    nameKey: nameKey(entry.name),
    parentId: entry.parentId,
    size: metadata?.size ?? null,
  });
  if (!row) {
    throw new Error('The catalog returned no row for an upsert.');
  }
  return row;
}

/** Removes the entry at `id`, and everything inside it if it is a folder. */
export function removeItem(db: CatalogDatabase, library: number, id: string): void {
  const { start, end } = inside(id);
  db.delete(items)
    .where(every(eq(items.library, library), eq(items.id, id)))
    .run();
  // A separate query, as SQLite would scan every row rather than search for either of two.
  db.delete(items)
    .where(every(eq(items.library, library), gte(items.id, start), lt(items.id, end)))
    .run();
}

/** The entry at the `id` placeholder, in the `library` placeholder's library. */
export const atPlaceholderId = every(
  eq(items.library, sql.placeholder('library')),
  eq(items.id, sql.placeholder('id')),
);

const itemOfQuery = preparedOnce((db) =>
  db.select({ item: items.item }).from(items).where(atPlaceholderId).prepare(),
);

/** The number of the entry at `id`, if the catalog has it. */
export function itemOf(db: CatalogDatabase, library: number, id: string): number | undefined {
  return itemOfQuery(db).get({ id, library })?.item;
}

/** What the catalog holds directly inside `directoryId`. */
export function listing(db: CatalogDatabase, library: number, directoryId: string): KnownItem[] {
  return db
    .select(knownColumns)
    .from(items)
    .where(inScope(library, { directoryId, recursive: false }))
    .all()
    .map((row) => knownItem(row));
}

/** What the catalog knows of the entries at `ids`, leaving out those it has none of. */
export function known(db: CatalogDatabase, library: number, ids: string[]): KnownItem[] {
  return db
    .select(knownColumns)
    .from(items)
    .where(every(eq(items.library, library), isIn(items.id, ids)))
    .all()
    .map((row) => knownItem(row));
}

/** The folders the catalog knows inside `directoryId`, however deep. */
export function foldersInside(db: CatalogDatabase, library: number, directoryId: string): string[] {
  const scope = { directoryId, recursive: true };
  const rows = db.all<{ id: string }>(sql`
    SELECT ${items.id} FROM ${readFrom(scope, 'items_kind')}
    WHERE ${inScope(library, scope)} AND ${eq(items.kind, KIND_CODES.directory)}`);
  return rows.map((row) => row.id);
}

const entryColumns = {
  accessedMs: items.accessedMs,
  createdMs: items.createdMs,
  exif: items.exif,
  exifRead: items.exifRead,
  id: items.id,
  item: items.item,
  kind: items.kind,
  modifiedMs: items.modifiedMs,
  name: items.name,
  parentId: items.parentId,
  size: items.size,
};

function entryOf(row: Pick<Item, keyof typeof entryColumns>): PhotoEntry {
  const entry: PhotoEntry = {
    id: row.id,
    kind: kindOf(row.kind),
    name: row.name,
    parentId: row.parentId,
  };
  if (row.size !== null) {
    entry.metadata = {
      accessedMs: row.accessedMs ?? 0,
      createdMs: row.createdMs ?? 0,
      modifiedMs: row.modifiedMs ?? 0,
      size: row.size,
    };
  }
  if (entry.kind === 'image' && row.exifRead !== 0) {
    entry.exif = row.exif === null ? {} : (JSON.parse(row.exif) as PhotoExif);
  }
  return entry;
}

/** The entries numbered `numbers`, in that order, leaving out any that are gone. */
export function entries(db: CatalogDatabase, numbers: number[]): PhotoEntry[] {
  const rows = db.select(entryColumns).from(items).where(isIn(items.item, numbers)).all();
  const found = new Map(rows.map((row) => [row.item, row]));
  return numbers.flatMap((item) => {
    const row = found.get(item);
    return row ? [entryOf(row)] : [];
  });
}
