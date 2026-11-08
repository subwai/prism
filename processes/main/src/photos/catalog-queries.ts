import { KINDS, nameFold } from '#photos/catalog-schema';
import type { PhotoEntry, PhotoExif, SortOrder } from '@prism/shared';
import path from 'node:path';
import type { SQLInputValue, StatementSync } from 'node:sqlite';

// The character after the separator, which ends the range of IDs inside a folder.
const AFTER_SEPARATOR = String.fromCodePoint((path.sep.codePointAt(0) ?? 0) + 1);

/** Which entries a view draws from: a folder's own, or everything inside it. */
export interface Scope {
  directoryId: string;
  recursive: boolean;
}

/** A photo whose details are wanted. */
export interface UnreadPhoto {
  item: number;
  id: string;
}

/** A scope's entries in order, and the kind of each as the catalog codes it. */
export interface ScopeOrder {
  items: Int32Array;
  kinds: Uint8Array;
}

interface ItemRow {
  item: number;
  id: string;
  parent_id: string;
  name: string;
  kind: number;
  size: number | null;
  created_ms: number | null;
  modified_ms: number | null;
  accessed_ms: number | null;
  exif_read: number;
  exif: string | null;
}

/** The IDs inside `folderId`, as a range: from its name and a separator to the character after. */
export function inside(folderId: string): { start: string; end: string } {
  return { end: `${folderId}${AFTER_SEPARATOR}`, start: `${folderId}${path.sep}` };
}

export const isRoot = ({ directoryId, recursive }: Scope): boolean =>
  recursive && directoryId === '.';

/** The order each sort reads entries in, folders first and the entry's own number last. */
const ORDER_BY: Record<SortOrder, string> = {
  created: 'grp, created_ms, name_key, item',
  modified: 'grp, modified_ms, name_key, item',
  name: 'grp, name_key, item',
  size: 'grp, size, name_key, item',
  taken: 'grp, coalesce(taken_ms, modified_ms), name_key, item',
};

/**
 * The index a whole library reads in each sort's order. The others sort what they read. With
 * one library, every index starting with it looks as good to SQLite as the next, and it picks
 * one that leaves everything to sort, so the queries name their index.
 */
const SORT_INDEXES: Partial<Record<SortOrder, string>> = {
  name: 'items_name',
  taken: 'items_taken',
};

/** Numbers SQLite gathered as a JSON array, which is far quicker than a row each. */
function numbers(json: unknown): number[] {
  return JSON.parse(typeof json === 'string' ? json : '[]') as number[];
}

function parseExif(row: Pick<ItemRow, 'exif_read' | 'exif'>): PhotoExif | undefined {
  if (row.exif_read === 0) {
    return undefined;
  }
  return row.exif === null ? {} : (JSON.parse(row.exif) as PhotoExif);
}

function entryOf(row: ItemRow): PhotoEntry {
  const entry: PhotoEntry = {
    id: row.id,
    kind: KINDS[row.kind] ?? 'file',
    name: row.name,
    parentId: row.parent_id,
  };
  if (row.size !== null) {
    entry.metadata = {
      accessedMs: row.accessed_ms ?? 0,
      createdMs: row.created_ms ?? 0,
      modifiedMs: row.modified_ms ?? 0,
      size: row.size,
    };
  }
  const exif = entry.kind === 'image' ? parseExif(row) : undefined;
  if (exif) {
    entry.exif = exif;
  }
  return entry;
}

/**
 * What views ask of one library's catalog: scopes in order, the entries a search or filter
 * lets through, rows to show and counts to filter by.
 */
export class CatalogQueries {
  constructor(
    private readonly sql: (text: string) => StatementSync,
    private readonly library: number,
  ) {}

  /**
   * Where `scope` reads from, and the parameters that says. `table` names the index a whole
   * library is read with, as SQLite picks badly between them; see `SORT_INDEXES`.
   */
  private scope(scope: Scope, index?: string) {
    if (isRoot(scope)) {
      return {
        params: [this.library] as SQLInputValue[],
        table: index ? `items INDEXED BY ${index}` : 'items',
        where: 'library = ?',
      };
    }
    if (scope.recursive) {
      const { start, end } = inside(scope.directoryId);
      return {
        params: [this.library, start, end] as SQLInputValue[],
        table: 'items INDEXED BY items_id',
        where: 'library = ? AND id >= ? AND id < ?',
      };
    }
    return {
      params: [this.library, scope.directoryId] as SQLInputValue[],
      table: 'items INDEXED BY items_parent',
      where: 'library = ? AND parent_id = ?',
    };
  }

  /**
   * Every entry of `scope` in `sort` order, ascending: views keep the kinds they show, and
   * reverse each group for a descending sort. SQLite gathers them into JSON arrays in the order
   * the subquery reads them, as it never flattens a subquery with an `ORDER BY` into an
   * aggregate.
   */
  order(scope: Scope, sort: SortOrder): ScopeOrder {
    const { table, where, params } = this.scope(
      scope,
      isRoot(scope) ? SORT_INDEXES[sort] : undefined,
    );
    const row = this.sql(
      `SELECT json_group_array(item) AS items, json_group_array(kind) AS kinds FROM (
         SELECT item, kind FROM ${table} WHERE ${where} ORDER BY ${ORDER_BY[sort]}
       )`,
    ).get(...params) as { items: string; kinds: string };
    return {
      items: Int32Array.from(numbers(row.items)),
      kinds: Uint8Array.from(numbers(row.kinds)),
    };
  }

  /** The largest entry number there has been, to size sets of them. */
  maxItem(): number {
    const row = this.sql("SELECT seq FROM sqlite_sequence WHERE name = 'items'").get() as
      | { seq: number }
      | undefined;
    return row?.seq ?? 0;
  }

  /** The entries of `scope` whose `field` is one of `values`. */
  having(scope: Scope, field: 'camera' | 'lens', values: string[]): number[] {
    const { table, where, params } = this.scope(scope, `items_${field}`);
    const row = this.sql(
      `SELECT json_group_array(item) AS items FROM ${table}
       WHERE ${where} AND ${field} IN (SELECT value FROM json_each(?))`,
    ).get(...params, JSON.stringify(values)) as { items: string };
    return numbers(row.items);
  }

  /** The photos tagged with any of `tags`, in any scope: views narrow them to their own. */
  tagged(tags: string[]): number[] {
    const row = this.sql(
      `SELECT json_group_array(item) AS items FROM item_tags
       WHERE library = ? AND tag IN (SELECT value FROM json_each(?))`,
    ).get(this.library, JSON.stringify(tags)) as { items: string };
    return numbers(row.items);
  }

  /** The entries of `scope` whose names contain `text`, which is folded as names are. */
  named(scope: Scope, text: string): number[] {
    const { table, where, params } = this.scope(scope);
    const row = this.sql(
      `SELECT json_group_array(item) AS items FROM ${table}
       WHERE ${where} AND instr(name_fold, ?) > 0`,
    ).get(...params, nameFold(text)) as { items: string };
    return numbers(row.items);
  }

  /** Every tag in the library, to find the ones a search matches. */
  tags(): string[] {
    const rows = this.sql('SELECT DISTINCT tag FROM item_tags WHERE library = ?').all(
      this.library,
    ) as { tag: string }[];
    return rows.map((row) => row.tag);
  }

  /** The entries numbered `items`, in that order, leaving out any that are gone. */
  rows(items: number[]): PhotoEntry[] {
    const rows = this.sql(
      `SELECT item, id, parent_id, name, kind, size, created_ms, modified_ms, accessed_ms,
         exif_read, exif
       FROM items WHERE item IN (SELECT value FROM json_each(?))`,
    ).all(JSON.stringify(items)) as unknown as ItemRow[];
    const found = new Map(rows.map((row) => [row.item, row]));
    return items.flatMap((item) => {
      const row = found.get(item);
      return row ? [entryOf(row)] : [];
    });
  }

  /** How many entries of `scope` have each value to filter by, and how many lack details. */
  counts(scope: Scope) {
    const field = (column: 'camera' | 'lens') => {
      const { table, where, params } = this.scope(scope, `items_${column}`);
      return this.sql(
        `SELECT ${column} AS value, count(*) AS count FROM ${table}
         WHERE ${where} AND ${column} IS NOT NULL GROUP BY ${column}`,
      ).all(...params) as { value: string; count: number }[];
    };
    const kinds = this.scope(scope, 'items_kind');
    const formats = this.sql(
      `SELECT kind, count(*) AS count FROM ${kinds.table}
       WHERE ${kinds.where} AND kind IN (1, 2) GROUP BY kind`,
    ).all(...kinds.params) as { kind: number; count: number }[];
    return {
      camera: field('camera'),
      formats: formats.map((row) => ({ count: row.count, kind: KINDS[row.kind] ?? 'file' })),
      lens: field('lens'),
      tag: this.tagCounts(scope),
      unread: this.unread(scope),
    };
  }

  private tagCounts(scope: Scope) {
    if (isRoot(scope)) {
      return this.sql(
        'SELECT tag AS value, count(*) AS count FROM item_tags WHERE library = ? GROUP BY tag',
      ).all(this.library) as { value: string; count: number }[];
    }
    const { table, where, params } = this.scope(scope);
    return this.sql(
      `SELECT tag AS value, count(*) AS count FROM item_tags
       WHERE item IN (SELECT item FROM ${table} WHERE ${where}) GROUP BY tag`,
    ).all(...params) as { value: string; count: number }[];
  }

  /** How many photos of `scope` have yet to have their details read. */
  unread(scope: Scope): number {
    const { table, where, params } = this.scope(scope, 'items_unread');
    const row = this.sql(
      `SELECT count(*) AS count FROM ${table} WHERE ${where} AND kind = 1 AND exif_read = 0`,
    ).get(...params) as { count: number };
    return row.count;
  }

  /** Of the entries numbered `items`, the photos whose details have yet to be read. */
  unreadAmong(items: number[]): UnreadPhoto[] {
    return this.sql(
      `SELECT item, id FROM items
       WHERE item IN (SELECT value FROM json_each(?)) AND kind = 1 AND exif_read = 0`,
    ).all(JSON.stringify(items)) as unknown as UnreadPhoto[];
  }

  /** Photos of the library whose details have yet to be read, numbered after `after`. */
  unreadAfter(after: number, limit: number): UnreadPhoto[] {
    return this.sql(
      `SELECT item, id FROM items INDEXED BY items_unread
       WHERE library = ? AND kind = 1 AND exif_read = 0 AND item > ? ORDER BY item LIMIT ?`,
    ).all(this.library, after, limit) as unknown as UnreadPhoto[];
  }
}
