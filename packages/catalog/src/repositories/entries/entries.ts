import { type CatalogDatabase, preparedOnce } from '#database/catalog-database';
import { entries, entryTags } from '#database/photo-index/schema';
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
import { isRating, type PhotoEntry, type PhotoExif } from '@prism/shared';
import { count, eq, sql } from 'drizzle-orm';

// A scope is the folders a view or query covers: one folder, or it and every folder inside it.
// A file's inode is its number on its disk, which a rename or move keeps.

/** What the catalog knows of an entry, to tell whether a new read of its folder finds it different. */
export interface CatalogEntry {
  id: string;
  kind: PhotoEntry['kind'];
  size: number | null;
  modifiedMs: number | null;
  /** The file's inode, `'0'` where the disk reports none; `null` if no read has kept it yet. */
  inode: string | null;
}

type EntryRow = typeof entries.$inferSelect;

const knownColumns = {
  inode: entries.inode,
  kind: entries.kind,
  modifiedMs: entries.modifiedMs,
  name: entries.name,
  parentId: parentPath,
  size: entries.size,
};

/** `knownColumns`, for a query that names its index, which Drizzle's builder cannot. */
const knownSelection = sql.join(
  Object.entries(knownColumns).map(([name, column]) => sql`${column} AS ${sql.identifier(name)}`),
  sql`, `,
);

function catalogEntryOf({
  parentId,
  name,
  kind,
  ...row
}: Pick<EntryRow, 'inode' | 'kind' | 'modifiedMs' | 'name' | 'size'> & {
  parentId: string;
}): CatalogEntry {
  return { ...row, id: entryId(parentId, name), kind: kindOf(kind) };
}

/**
 * Removes the entry at `id`, and everything inside it if it is a folder. Returns whether it was a
 * folder.
 */
export function removeEntry(db: CatalogDatabase, library: number, id: string): boolean {
  const [removed] = db
    .delete(entries)
    .where(atId(library, id))
    .returning({ kind: entries.kind })
    .all();
  // A separate query, as SQLite would scan every row rather than search for either of two.
  db.delete(entries)
    .where(sql`${entries.parent} IN ${folderAndInside(library, id)}`)
    .run();
  return removed?.kind === KIND_CODES.directory;
}

/**
 * Moves the entry at `from` into the folder numbered `parent` as `name`, as it was renamed or
 * moved. Its row keeps its number, so its details, tags and covers stay with it. Returns its
 * number and kind, or `undefined` if the catalog has no entry at `from`.
 */
export function moveEntry(
  db: CatalogDatabase,
  library: number,
  from: string,
  parent: number,
  name: string,
): { entry: number; kind: number } | undefined {
  const [moved] = db
    .update(entries)
    .set({ name, nameFold: nameFold(name), nameKey: nameKey(name), parent })
    .where(atId(library, from))
    .returning({ entry: entries.entry, kind: entries.kind })
    .all();
  return moved;
}

const entryNumberQuery = preparedOnce((db) =>
  db.select({ entry: entries.entry }).from(entries).where(atPlaceholderId).prepare(),
);

/** The number of the entry at `id`, if the catalog has it. */
export function entryNumberOf(
  db: CatalogDatabase,
  library: number,
  id: string,
): number | undefined {
  return entryNumberQuery(db).get({ ...placeOf(id), library })?.entry;
}

/**
 * What the catalog holds directly inside `directoryId`, through the index `readFrom` names:
 * left to choose, SQLite reads the whole library through `entries_kind` to find the folder's.
 */
export function catalogEntriesIn(
  db: CatalogDatabase,
  library: number,
  directoryId: string,
): CatalogEntry[] {
  const scope = { directoryId, recursive: false };
  return db
    .all<Parameters<typeof catalogEntryOf>[0]>(
      sql`SELECT ${knownSelection} FROM ${readFrom(scope)} WHERE ${inScope(library, scope)}`,
    )
    .map((row) => catalogEntryOf(row));
}

/** What the catalog knows of the entries at `ids`, leaving out those it has none of. */
export function catalogEntriesAt(
  db: CatalogDatabase,
  library: number,
  ids: string[],
): CatalogEntry[] {
  return db
    .select(knownColumns)
    .from(entries)
    .where(atIds(library, ids))
    .all()
    .map((row) => catalogEntryOf(row));
}

const entryColumns = {
  accessedMs: entries.accessedMs,
  createdMs: entries.createdMs,
  entry: entries.entry,
  exif: entries.exif,
  exifRead: entries.exifRead,
  inode: entries.inode,
  kind: entries.kind,
  modifiedMs: entries.modifiedMs,
  name: entries.name,
  parentId: parentPath,
  rating: entries.rating,
  size: entries.size,
};

function entryOf(
  row: Pick<EntryRow, Exclude<keyof typeof entryColumns, 'parentId'>> & { parentId: string },
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
export function catalogEntriesByNumber(
  db: CatalogDatabase,
  numbers: number[],
): Map<number, CatalogEntry> {
  const rows = db
    .select({ ...knownColumns, entry: entries.entry })
    .from(entries)
    .where(isIn(entries.entry, numbers))
    .all();
  return new Map(rows.map(({ entry, ...row }) => [entry, catalogEntryOf(row)]));
}

/** The entries numbered `numbers`, by number, leaving out any that are gone. */
export function entriesByNumber(db: CatalogDatabase, numbers: number[]): Map<number, PhotoEntry> {
  const rows = db.select(entryColumns).from(entries).where(isIn(entries.entry, numbers)).all();
  return new Map(rows.map((row) => [row.entry, entryOf(row)]));
}

/** The entries numbered `numbers`, in that order, leaving out any that are gone. */
export function entriesInOrder(db: CatalogDatabase, numbers: number[]): PhotoEntry[] {
  const found = entriesByNumber(db, numbers);
  return numbers.flatMap((entry) => found.get(entry) ?? []);
}

/** An entry the catalog has, by its ID and its number. */
export interface NumberedEntry {
  id: string;
  entry: number;
  kind: PhotoEntry['kind'];
}

/**
 * The entries of `scope` at `ids`, leaving out those it has none of: each found by its ID
 * through `entries_name`, where SQLite would read the whole library through `entries_kind`.
 */
export function findInScope(
  db: CatalogDatabase,
  library: number,
  scope: Scope,
  ids: string[],
): NumberedEntry[] {
  return db
    .all<{ entry: number; kind: number; name: string; parentId: string }>(
      sql`SELECT ${entries.entry} AS entry, ${entries.kind} AS kind, ${entries.name} AS name,
        ${parentPath} AS parentId FROM ${entries} INDEXED BY entries_name
        WHERE ${matchAll(inScope(library, scope), atIds(library, ids))}`,
    )
    .map((row) => ({
      entry: row.entry,
      id: entryId(row.parentId, row.name),
      kind: kindOf(row.kind),
    }));
}

/** An entry inside a folder, as a plan to move entries to the Trash reads it. */
export interface TreeEntry {
  entry: number;
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
export function treeInside(db: CatalogDatabase, library: number, directoryId: string): TreeEntry[] {
  const scope = { directoryId, recursive: true };
  return db
    .all<Omit<TreeEntry, 'id' | 'kind' | 'tags'> & { kind: number; tags: string | null }>(
      sql`
      SELECT ${entries.entry} AS entry, ${parentPath} AS parentId, ${entries.name} AS name, ${entries.kind} AS kind, ${entries.size} AS size,
        ${entries.modifiedMs} AS modifiedMs, ${entries.rating} AS rating,
        ${entries.camera} AS camera, ${entries.lens} AS lens,
        (SELECT json_group_array(${entryTags.tag}) FROM ${entryTags}
          WHERE ${entryTags.entry} = ${entries.entry}) AS tags
      FROM ${readFrom(scope)} WHERE ${inScope(library, scope)}
      ORDER BY ${entries.grp}, ${entries.nameKey}, ${entries.entry}`,
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
export function countEntries(db: CatalogDatabase, library: number): number {
  const [row] = db
    .select({ count: count() })
    .from(entries)
    .where(eq(entries.library, library))
    .all();
  return row?.count ?? 0;
}

/** Deletes every entry of `library`. */
export function deleteEntriesOfLibrary(db: CatalogDatabase, library: number): void {
  db.delete(entries).where(eq(entries.library, library)).run();
}

/** The largest entry number there has been, to size sets of them. */
export function largestEntryNumber(db: CatalogDatabase): number {
  const row = db.get<{ seq: number }>(sql`SELECT seq FROM sqlite_sequence WHERE name = 'entries'`);
  return row?.seq ?? 0;
}
