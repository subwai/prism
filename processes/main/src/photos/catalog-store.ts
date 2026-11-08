import { CatalogQueries, inside } from '#photos/catalog-queries';
import { KIND_CODES, KINDS, nameFold, nameKey, transaction, UPSERT } from '#photos/catalog-schema';
import type { PhotoEntry, PhotoExif } from '@prism/shared';
import type { DatabaseSync, StatementSync } from 'node:sqlite';

export type { Scope, UnreadPhoto } from '#photos/catalog-queries';

/** A photo's details, read while its file had this size and modification time. */
export interface PhotoDetails {
  id: string;
  size: number;
  modifiedMs: number;
  exif: PhotoExif;
}

/** What changes the catalog, applied in order and together. */
export type CatalogWrite =
  /** Entries as a read listed them, or as a change on disk left them, details and all. */
  | { listed: PhotoEntry[] }
  /** Entries that went, folders with everything inside them. */
  | { removed: string[] }
  /** A folder read to the end, whose rows are now all it holds. */
  | { indexed: string }
  | { details: PhotoDetails[] };

/** What the catalog knows of an entry, to tell whether a listing of it is different. */
export interface KnownItem {
  id: string;
  kind: PhotoEntry['kind'];
  size: number | null;
  modifiedMs: number | null;
}

/** Photos a write left without details: `missed` as their files changed since they were read. */
interface Written {
  missed: number[];
  unread: number[];
}

interface KnownRow {
  id: string;
  kind: number;
  size: number | null;
  modified_ms: number | null;
}

function knownItem(row: KnownRow): KnownItem {
  return {
    id: row.id,
    kind: KINDS[row.kind] ?? 'file',
    modifiedMs: row.modified_ms,
    size: row.size,
  };
}

/**
 * One library's entries in the catalog: what a read listed, kept as the disk changes, with
 * photos' details as they are read. It reads and writes synchronously, so it lives on a thread
 * of its own; see `catalog-host.ts`. Every write bumps `generation`, which tells views whose
 * order may have changed; `queries` is what they ask of it.
 */
export class CatalogStore {
  readonly library: number;
  readonly queries: CatalogQueries;
  generation = 0;
  private readonly statements = new Map<string, StatementSync>();

  constructor(
    private readonly database: DatabaseSync,
    readonly root: string,
  ) {
    database
      .prepare(
        `INSERT INTO libraries (root, used_ms) VALUES (?, ?)
         ON CONFLICT (root) DO UPDATE SET used_ms = excluded.used_ms`,
      )
      .run(root, Date.now());
    const row = database.prepare('SELECT library FROM libraries WHERE root = ?').get(root) as {
      library: number;
    };
    this.library = row.library;
    this.queries = new CatalogQueries((text) => this.sql(text), this.library);
  }

  /** A statement prepared once. */
  private sql(text: string) {
    let statement = this.statements.get(text);
    if (!statement) {
      statement = this.database.prepare(text);
      this.statements.set(text, statement);
    }
    return statement;
  }

  /**
   * Applies `writes` in one transaction, and says which photos it left without details: those
   * listed afresh, and those whose details it left out as their files changed since.
   */
  write(writes: CatalogWrite[]): Written {
    const written: Written = { missed: [], unread: [] };
    if (writes.length === 0) {
      return written;
    }
    transaction(this.database, () => {
      for (const write of writes) {
        this.apply(write, written);
      }
    });
    this.generation += 1;
    return written;
  }

  private apply(write: CatalogWrite, written: Written) {
    if ('listed' in write) {
      for (const entry of write.listed) {
        const item = this.upsert(entry);
        if (item !== undefined) {
          written.unread.push(item);
        }
      }
    } else if ('removed' in write) {
      for (const id of write.removed) {
        this.remove(id);
      }
    } else if ('indexed' in write) {
      this.sql('INSERT OR IGNORE INTO indexed_folders (library, directory_id) VALUES (?, ?)').run(
        this.library,
        write.indexed,
      );
    } else {
      for (const details of write.details) {
        const item = this.setDetails(details);
        if (item !== undefined) {
          written.missed.push(item);
        }
      }
    }
  }

  /**
   * Adds or updates an entry. A file that changed loses its details, as they described what it
   * held before; ones the entry brings, as a change on disk does, replace them. Returns the
   * entry's number if it is a photo left without details.
   */
  private upsert(entry: PhotoEntry): number | undefined {
    const kind = KIND_CODES[entry.kind];
    const { metadata } = entry;
    const row = this.sql(UPSERT).get({
      accessed: metadata?.accessedMs ?? null,
      created: metadata?.createdMs ?? null,
      fold: nameFold(entry.name),
      grp: kind === KIND_CODES.directory ? 0 : 1,
      id: entry.id,
      key: nameKey(entry.name),
      kind,
      library: this.library,
      modified: metadata?.modifiedMs ?? null,
      name: entry.name,
      parent: entry.parentId,
      size: metadata?.size ?? null,
    }) as { item: number; kind: number; exif_read: number };
    if (entry.kind === 'image' && entry.exif && metadata) {
      this.setDetails({
        exif: entry.exif,
        id: entry.id,
        modifiedMs: metadata.modifiedMs,
        size: metadata.size,
      });
      return undefined;
    }
    return row.kind === KIND_CODES.image && row.exif_read === 0 ? row.item : undefined;
  }

  /** Removes an entry, and if it is a folder, everything inside it. */
  private remove(id: string) {
    const { start, end } = inside(id);
    for (const [table, column] of [
      ['items', 'id'],
      ['indexed_folders', 'directory_id'],
    ] as const) {
      this.sql(`DELETE FROM ${table} WHERE library = ? AND ${column} = ?`).run(this.library, id);
      this.sql(`DELETE FROM ${table} WHERE library = ? AND ${column} >= ? AND ${column} < ?`).run(
        this.library,
        start,
        end,
      );
    }
  }

  /**
   * Stores a photo's details, unless its file changed since they were read: then it returns
   * the photo's number, if the catalog has it.
   */
  private setDetails({ id, size, modifiedMs, exif }: PhotoDetails): number | undefined {
    const { changes } = this.sql(
      `UPDATE items SET exif_read = 1, taken_ms = ?, camera = ?, lens = ?, exif = ?
       WHERE library = ? AND id = ? AND kind = ? AND size IS ? AND modified_ms IS ?`,
    ).run(
      exif.takenMs ?? null,
      exif.camera ?? null,
      exif.lens ?? null,
      JSON.stringify(exif),
      this.library,
      id,
      KIND_CODES.image,
      size,
      modifiedMs,
    );
    const item = this.itemOf(id);
    if (Number(changes) === 0 || item === undefined) {
      return item;
    }
    this.sql('DELETE FROM item_tags WHERE item = ?').run(item);
    const tag = this.sql('INSERT OR IGNORE INTO item_tags (library, tag, item) VALUES (?, ?, ?)');
    for (const value of exif.tags ?? []) {
      tag.run(this.library, value, item);
    }
    return undefined;
  }

  /** The number of the entry at `id`, if the catalog has it. */
  itemOf(id: string): number | undefined {
    const row = this.sql('SELECT item FROM items WHERE library = ? AND id = ?').get(
      this.library,
      id,
    ) as { item: number } | undefined;
    return row?.item;
  }

  /** Whether `directoryId` was read to the end, so its rows are all it holds. */
  isIndexed(directoryId: string): boolean {
    const row = this.sql(
      'SELECT 1 FROM indexed_folders WHERE library = ? AND directory_id = ?',
    ).get(this.library, directoryId);
    return row !== undefined;
  }

  /** The folders the catalog knows inside `directoryId`, however deep. */
  foldersInside(directoryId: string): string[] {
    const { start, end } = inside(directoryId);
    const rows =
      directoryId === '.'
        ? this.sql('SELECT id FROM items INDEXED BY items_kind WHERE library = ? AND kind = 0').all(
            this.library,
          )
        : this.sql(
            `SELECT id FROM items INDEXED BY items_id
             WHERE library = ? AND id >= ? AND id < ? AND kind = 0`,
          ).all(this.library, start, end);
    return (rows as { id: string }[]).map((row) => row.id);
  }

  /** What the catalog holds directly inside `directoryId`, to tell what a new read changes. */
  listing(directoryId: string): KnownItem[] {
    const rows = this.sql(
      `SELECT id, kind, size, modified_ms FROM items INDEXED BY items_parent
       WHERE library = ? AND parent_id = ?`,
    ).all(this.library, directoryId) as unknown as KnownRow[];
    return rows.map((row) => knownItem(row));
  }

  /** What the catalog knows of the entries at `ids`, leaving out those it has none of. */
  known(ids: string[]): KnownItem[] {
    const rows = this.sql(
      `SELECT id, kind, size, modified_ms FROM items
       WHERE library = ? AND id IN (SELECT value FROM json_each(?))`,
    ).all(this.library, JSON.stringify(ids)) as unknown as KnownRow[];
    return rows.map((row) => knownItem(row));
  }
}
