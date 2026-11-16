import { KIND_CODES, kindOf, nameFold, nameKey } from '#data/codes';
import { type CatalogDatabase, isIn, preparedOnce } from '#data/database';
import {
  entryId,
  every,
  folderAndInside,
  folderAt,
  inScope,
  inside,
  parentPath,
  placeOf,
  readFrom,
  type Scope,
} from '#data/scope';
import { folders, items, itemTags } from '#index-schema';
import { isRating, type PhotoEntry, type PhotoExif } from '@prism/shared';
import { and, eq, gte, isNotNull, lt, type SQL, sql } from 'drizzle-orm';

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

export const knownColumns = {
  inode: items.inode,
  kind: items.kind,
  modifiedMs: items.modifiedMs,
  name: items.name,
  parentId: parentPath,
  size: items.size,
};

export function knownItem({
  parentId,
  name,
  kind,
  ...row
}: Pick<Item, 'inode' | 'kind' | 'modifiedMs' | 'name' | 'size'> & {
  parentId: string;
}): KnownItem {
  return { ...row, id: entryId(parentId, name), kind: kindOf(kind) };
}

/** The entry at `id` in `library`: its name in its folder, through `items_entry`. */
function atId(library: number, id: string): SQL {
  const { parentId, name } = placeOf(id);
  return every(eq(items.parent, folderAt(library, parentId)), eq(items.name, name));
}

/**
 * The entries at `ids` in `library`, through `items_entry`, however many there are. The `CROSS
 * JOIN` finds each one's folder by its path, where SQLite would read every folder of the
 * library for each.
 */
export function atIds(library: number, ids: readonly string[]): SQL {
  const places = JSON.stringify(
    ids.map((id) => {
      const { parentId, name } = placeOf(id);
      return [parentId, name];
    }),
  );
  return sql`(${items.parent}, ${items.name}) IN (
    SELECT ${folders.folder}, value ->> 1 FROM json_each(${places})
    CROSS JOIN ${folders} ON ${folders.library} = ${library} AND ${folders.path} = value ->> 0)`;
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

const placeholderFolder = folderAt(sql.placeholder('library'), sql.placeholder('parentId'));

/**
 * The entry named by the `name` placeholder in the folder at the `parentId` placeholder, in the
 * `library` placeholder's library; `placeOf` gives the two of an ID.
 */
export const atPlaceholderId = every(
  eq(items.parent, placeholderFolder),
  eq(items.name, sql.placeholder('name')),
);

const itemOfQuery = preparedOnce((db) =>
  db.select({ item: items.item }).from(items).where(atPlaceholderId).prepare(),
);

/** The number of the entry at `id`, if the catalog has it. */
export function itemOf(db: CatalogDatabase, library: number, id: string): number | undefined {
  return itemOfQuery(db).get({ ...placeOf(id), library })?.item;
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
    .where(atIds(library, ids))
    .all()
    .map((row) => knownItem(row));
}

/**
 * The folders the catalog knows inside `directoryId`, however deep: those with rows, which the
 * library's own folder has none of.
 */
export function foldersInside(db: CatalogDatabase, library: number, directoryId: string): string[] {
  const { start, end } = inside(directoryId);
  // IDs at the top of the library have no `./` before them.
  const range = directoryId === '.' ? [] : [gte(folders.path, start), lt(folders.path, end)];
  return db
    .select({ path: folders.path })
    .from(folders)
    .where(and(eq(folders.library, library), ...range, isNotNull(folders.item)))
    .all()
    .map((row) => row.path);
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

/** The entries numbered `numbers`, by number, leaving out any that are gone. */
export function entriesByNumber(db: CatalogDatabase, numbers: number[]): Map<number, PhotoEntry> {
  const rows = db.select(entryColumns).from(items).where(isIn(items.item, numbers)).all();
  return new Map(rows.map((row) => [row.item, entryOf(row)]));
}

/** The entries numbered `numbers`, in that order, leaving out any that are gone. */
export function entries(db: CatalogDatabase, numbers: number[]): PhotoEntry[] {
  const found = entriesByNumber(db, numbers);
  return numbers.flatMap((item) => found.get(item) ?? []);
}

/** An entry the catalog has, by its ID and its number. */
export interface NumberedItem {
  id: string;
  item: number;
  kind: PhotoEntry['kind'];
}

/** The entries of `scope` at `ids`, leaving out those it has none of. */
export function among(
  db: CatalogDatabase,
  library: number,
  scope: Scope,
  ids: string[],
): NumberedItem[] {
  return db
    .select({ item: items.item, kind: items.kind, name: items.name, parentId: parentPath })
    .from(items)
    .where(every(inScope(library, scope), atIds(library, ids)))
    .all()
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
