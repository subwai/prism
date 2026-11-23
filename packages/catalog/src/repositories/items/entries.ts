import { type CatalogDatabase, preparedOnce } from '#database/catalog-database';
import { KIND_CODES, kindOf, nameFold, nameKey } from '#repositories/queries/codes';
import {
  atId,
  atIds,
  atPlaceholderId,
  entryId,
  folderAndInside,
  parentPath,
  placeOf,
} from '#repositories/queries/entry-ids';
import { inScope, readFrom, type Scope } from '#repositories/queries/scope';
import { isIn, matchAll } from '#repositories/queries/sql-helpers';
import { items, itemTags } from '#schema/photo-index';
import { isRating, type PhotoEntry, type PhotoExif } from '@prism/shared';
import { count, eq, sql } from 'drizzle-orm';

/** What the catalog knows of an entry, to tell whether a listing of it is different. */
export interface KnownItem {
  id: string;
  kind: PhotoEntry['kind'];
  size: number | null;
  modifiedMs: number | null;
  /** The file's inode, `'0'` where the disk reports none; `null` if no read has kept it yet. */
  inode: string | null;
}

type Item = typeof items.$inferSelect;

const knownColumns = {
  inode: items.inode,
  kind: items.kind,
  modifiedMs: items.modifiedMs,
  name: items.name,
  parentId: parentPath,
  size: items.size,
};

/** `knownColumns`, for a query that names its index, which Drizzle's builder cannot. */
const knownSelection = sql.join(
  Object.entries(knownColumns).map(([name, column]) => sql`${column} AS ${sql.identifier(name)}`),
  sql`, `,
);

function knownItem({
  parentId,
  name,
  kind,
  ...row
}: Pick<Item, 'inode' | 'kind' | 'modifiedMs' | 'name' | 'size'> & {
  parentId: string;
}): KnownItem {
  return { ...row, id: entryId(parentId, name), kind: kindOf(kind) };
}

/**
 * Removes the entry at `id`, and everything inside it if it is a folder. Returns whether it was a
 * folder.
 */
export function removeItem(db: CatalogDatabase, library: number, id: string): boolean {
  const [removed] = db.delete(items).where(atId(library, id)).returning({ kind: items.kind }).all();
  // A separate query, as SQLite would scan every row rather than search for either of two.
  db.delete(items)
    .where(sql`${items.parent} IN ${folderAndInside(library, id)}`)
    .run();
  return removed?.kind === KIND_CODES.directory;
}

/**
 * Moves the entry at `from` into the folder numbered `parent` as `name`, as it was renamed or
 * moved. Its row keeps its number, so its details, tags and covers stay with it. Returns its
 * number and kind, or `undefined` if the catalog has no entry at `from`.
 */
export function moveItem(
  db: CatalogDatabase,
  library: number,
  from: string,
  parent: number,
  name: string,
): { item: number; kind: number } | undefined {
  const [moved] = db
    .update(items)
    .set({ name, nameFold: nameFold(name), nameKey: nameKey(name), parent })
    .where(atId(library, from))
    .returning({ item: items.item, kind: items.kind })
    .all();
  return moved;
}

const itemOfQuery = preparedOnce((db) =>
  db.select({ item: items.item }).from(items).where(atPlaceholderId).prepare(),
);

/** The number of the entry at `id`, if the catalog has it. */
export function itemOf(db: CatalogDatabase, library: number, id: string): number | undefined {
  return itemOfQuery(db).get({ ...placeOf(id), library })?.item;
}

/**
 * What the catalog holds directly inside `directoryId`, through the index `readFrom` names:
 * left to choose, SQLite reads the whole library through `items_kind` to find the folder's.
 */
export function knownItemsIn(
  db: CatalogDatabase,
  library: number,
  directoryId: string,
): KnownItem[] {
  const scope = { directoryId, recursive: false };
  return db
    .all<Parameters<typeof knownItem>[0]>(
      sql`SELECT ${knownSelection} FROM ${readFrom(scope)} WHERE ${inScope(library, scope)}`,
    )
    .map((row) => knownItem(row));
}

/** What the catalog knows of the entries at `ids`, leaving out those it has none of. */
export function knownItemsAt(db: CatalogDatabase, library: number, ids: string[]): KnownItem[] {
  return db
    .select(knownColumns)
    .from(items)
    .where(atIds(library, ids))
    .all()
    .map((row) => knownItem(row));
}

const entryColumns = {
  accessedMs: items.accessedMs,
  createdMs: items.createdMs,
  exif: items.exif,
  exifRead: items.exifRead,
  inode: items.inode,
  item: items.item,
  kind: items.kind,
  modifiedMs: items.modifiedMs,
  name: items.name,
  parentId: parentPath,
  rating: items.rating,
  size: items.size,
};

function entryOf(
  row: Pick<Item, Exclude<keyof typeof entryColumns, 'parentId'>> & { parentId: string },
): PhotoEntry {
  const entry: PhotoEntry = {
    id: entryId(row.parentId, row.name),
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
    // Names the entry's thumbnail, so the window's request for it needs no look at the catalog.
    if (row.inode !== null) {
      entry.metadata.inode = row.inode;
    }
  }
  if (entry.kind === 'image' && row.exifRead !== 0) {
    entry.exif = row.exif === null ? {} : (JSON.parse(row.exif) as PhotoExif);
  }
  if (isRating(row.rating)) {
    entry.rating = row.rating;
  }
  return entry;
}

/** What the catalog knows of the entries numbered `numbers`, by number, leaving out any gone. */
export function knownItemsByNumber(db: CatalogDatabase, numbers: number[]): Map<number, KnownItem> {
  const rows = db
    .select({ ...knownColumns, item: items.item })
    .from(items)
    .where(isIn(items.item, numbers))
    .all();
  return new Map(rows.map(({ item, ...row }) => [item, knownItem(row)]));
}

/** The entries numbered `numbers`, by number, leaving out any that are gone. */
export function entriesByNumber(db: CatalogDatabase, numbers: number[]): Map<number, PhotoEntry> {
  const rows = db.select(entryColumns).from(items).where(isIn(items.item, numbers)).all();
  return new Map(rows.map((row) => [row.item, entryOf(row)]));
}

/** The entries numbered `numbers`, in that order, leaving out any that are gone. */
export function entriesInOrder(db: CatalogDatabase, numbers: number[]): PhotoEntry[] {
  const found = entriesByNumber(db, numbers);
  return numbers.flatMap((item) => found.get(item) ?? []);
}

/** An entry the catalog has, by its ID and its number. */
export interface NumberedItem {
  id: string;
  item: number;
  kind: PhotoEntry['kind'];
}

/**
 * The entries of `scope` at `ids`, leaving out those it has none of: each found by its ID
 * through `items_entry`, where SQLite would read the whole library through `items_kind`.
 */
export function findInScope(
  db: CatalogDatabase,
  library: number,
  scope: Scope,
  ids: string[],
): NumberedItem[] {
  return db
    .all<{ item: number; kind: number; name: string; parentId: string }>(
      sql`SELECT ${items.item} AS item, ${items.kind} AS kind, ${items.name} AS name,
        ${parentPath} AS parentId FROM ${items} INDEXED BY items_entry
        WHERE ${matchAll(inScope(library, scope), atIds(library, ids))}`,
    )
    .map((row) => ({
      id: entryId(row.parentId, row.name),
      item: row.item,
      kind: kindOf(row.kind),
    }));
}

/** An entry inside a folder, as a plan to move entries to the Trash reads it. */
export interface TreeItem {
  item: number;
  id: string;
  parentId: string;
  name: string;
  kind: PhotoEntry['kind'];
  size: number | null;
  modifiedMs: number | null;
  /** A photo's rating from its file; the ratings file keeps the rest. */
  rating: number | null;
  camera: string | null;
  lens: string | null;
  tags: string[];
}

/** Everything inside `directoryId`, however deep: folders first, then by name. */
export function treeInside(db: CatalogDatabase, library: number, directoryId: string): TreeItem[] {
  const scope = { directoryId, recursive: true };
  return db
    .all<Omit<TreeItem, 'id' | 'kind' | 'tags'> & { kind: number; tags: string | null }>(
      sql`
      SELECT ${items.item} AS item, ${parentPath} AS parentId, ${items.name} AS name, ${items.kind} AS kind, ${items.size} AS size,
        ${items.modifiedMs} AS modifiedMs, ${items.rating} AS rating,
        ${items.camera} AS camera, ${items.lens} AS lens,
        (SELECT json_group_array(${itemTags.tag}) FROM ${itemTags}
          WHERE ${itemTags.item} = ${items.item}) AS tags
      FROM ${readFrom(scope)} WHERE ${inScope(library, scope)}
      ORDER BY ${items.grp}, ${items.nameKey}, ${items.item}`,
    )
    .map((row) =>
      Object.assign(row, {
        id: entryId(row.parentId, row.name),
        kind: kindOf(row.kind),
        tags: row.tags ? (JSON.parse(row.tags) as string[]) : [],
      }),
    );
}

/** How many entries the catalog holds of `library`. */
export function countItems(db: CatalogDatabase, library: number): number {
  const [row] = db.select({ count: count() }).from(items).where(eq(items.library, library)).all();
  return row?.count ?? 0;
}
