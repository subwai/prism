import type { Detail } from '#photos/read-folder';
import type { PhotoEntry } from '@prism/shared';
import path from 'node:path';
import type { DatabaseSync, StatementSync } from 'node:sqlite';

// Entries kept across every library, most recently used first. A row takes a hundred bytes or
// so, so this keeps the index to a few hundred megabytes while holding a library of a million.
const MAX_STORED_ENTRIES = 1_000_000,
  // A hit marks its listing as used this often at most, to spare a write for every read.
  TOUCH_AFTER_MS = 60 * 60 * 1000;

export interface StoredListing {
  detail: Detail;
  entries: PhotoEntry[];
}

interface FolderRow {
  detail: Detail;
  used_ms: number;
}

interface EntryRow {
  name: string;
  kind: PhotoEntry['kind'];
  size: number | null;
  modified_ms: number | null;
  created_ms: number | null;
  accessed_ms: number | null;
  exif: string | null;
}

// The character after the separator, which ends the range of IDs inside a folder.
const AFTER_SEPARATOR = String.fromCodePoint((path.sep.codePointAt(0) ?? 0) + 1);

/**
 * The IDs inside `folderId`, as a range of the index rather than a scan of every row: from the
 * folder's name and a separator up to its name and the character after the separator.
 */
function inside(folderId: string) {
  return { end: `${folderId}${AFTER_SEPARATOR}`, start: `${folderId}${path.sep}` };
}

function entryOf(parentId: string, row: EntryRow): PhotoEntry {
  const entry: PhotoEntry = {
    id: path.join(parentId, row.name),
    kind: row.kind,
    name: row.name,
    parentId,
  };
  if (row.size !== null) {
    entry.metadata = {
      accessedMs: row.accessed_ms ?? 0,
      createdMs: row.created_ms ?? 0,
      modifiedMs: row.modified_ms ?? 0,
      size: row.size,
    };
  }
  if (row.exif !== null) {
    entry.exif = JSON.parse(row.exif) as PhotoEntry['exif'];
  }
  return entry;
}

/**
 * The listings of one library's folders as complete reads found them, kept in the photo index
 * so they outlast the session: a row for each entry, and one for each folder read to the end.
 * What was stored may have changed while the app was closed, so whoever shows a stored listing
 * reads the folder again to catch up. A write that fails only means the folder is read from the
 * disk next time, so failures are warnings rather than errors.
 */
export class StoredListings {
  private readonly selectFolder: StatementSync;
  private readonly selectEntries: StatementSync;
  private readonly upsertFolder: StatementSync;
  private readonly insertEntry: StatementSync;
  private readonly touch: StatementSync;
  private readonly removeFolder: StatementSync;
  private readonly removeEntries: StatementSync;
  private readonly removeFoldersInside: StatementSync;
  private readonly removeEntriesInside: StatementSync;
  private readonly removeAllFolders: StatementSync;
  private readonly removeAllEntries: StatementSync;

  constructor(
    private readonly database: DatabaseSync,
    private readonly root: string,
  ) {
    this.selectFolder = database.prepare(
      'SELECT detail, used_ms FROM folders WHERE root = ? AND directory_id = ?',
    );
    this.selectEntries = database.prepare(
      `SELECT name, kind, size, modified_ms, created_ms, accessed_ms, exif FROM entries
       WHERE root = ? AND parent_id = ?`,
    );
    this.upsertFolder = database.prepare(
      `INSERT OR REPLACE INTO folders (root, directory_id, detail, count, used_ms)
       VALUES (?, ?, ?, ?, ?)`,
    );
    this.insertEntry = database.prepare(
      `INSERT OR REPLACE INTO entries
       (root, parent_id, name, kind, size, modified_ms, created_ms, accessed_ms, exif)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.touch = database.prepare(
      'UPDATE folders SET used_ms = ? WHERE root = ? AND directory_id = ?',
    );
    this.removeFolder = database.prepare('DELETE FROM folders WHERE root = ? AND directory_id = ?');
    this.removeEntries = database.prepare('DELETE FROM entries WHERE root = ? AND parent_id = ?');
    // The folder's own listing goes through `removeFolder` and `removeEntries`: SQLite would
    // scan every row rather than search the index for either of two conditions.
    this.removeFoldersInside = database.prepare(
      'DELETE FROM folders WHERE root = :root AND directory_id >= :start AND directory_id < :end',
    );
    this.removeEntriesInside = database.prepare(
      'DELETE FROM entries WHERE root = :root AND parent_id >= :start AND parent_id < :end',
    );
    this.removeAllFolders = database.prepare('DELETE FROM folders WHERE root = ?');
    this.removeAllEntries = database.prepare('DELETE FROM entries WHERE root = ?');
  }

  /** Drops the listings used longest ago, past the budget of entries kept in all. */
  static prune(database: DatabaseSync, budget = MAX_STORED_ENTRIES): void {
    const pruned = database
      .prepare(
        `SELECT root, directory_id FROM (
           SELECT root, directory_id,
             SUM(count) OVER (ORDER BY used_ms DESC, root, directory_id) AS kept
           FROM folders
         ) WHERE kept > ?`,
      )
      .all(budget) as { root: string; directory_id: string }[];
    if (pruned.length === 0) {
      return;
    }
    const folder = database.prepare('DELETE FROM folders WHERE root = ? AND directory_id = ?');
    const entries = database.prepare('DELETE FROM entries WHERE root = ? AND parent_id = ?');
    database.exec('BEGIN IMMEDIATE');
    try {
      for (const { root, directory_id: directoryId } of pruned) {
        folder.run(root, directoryId);
        entries.run(root, directoryId);
      }
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }

  /** How much the stored listing of `directoryId` tells, if there is one. */
  detailOf(directoryId: string): Detail | undefined {
    return this.attempt(
      () => this.selectFolder.get(this.root, directoryId) as FolderRow | undefined,
      'read',
    )?.detail;
  }

  /** The listing of `directoryId`, if one is stored. */
  get(directoryId: string): StoredListing | undefined {
    const folder = this.attempt(
      () => this.selectFolder.get(this.root, directoryId) as FolderRow | undefined,
      'read',
    );
    if (!folder) {
      return undefined;
    }
    const rows = this.attempt(
      () => this.selectEntries.all(this.root, directoryId) as unknown as EntryRow[],
      'read',
    );
    if (!rows) {
      return undefined;
    }
    const now = Date.now();
    if (now - folder.used_ms > TOUCH_AFTER_MS) {
      this.attempt(() => this.touch.run(now, this.root, directoryId), 'write');
    }
    return { detail: folder.detail, entries: rows.map((row) => entryOf(directoryId, row)) };
  }

  set(directoryId: string, { detail, entries }: StoredListing): void {
    this.transaction(() => {
      this.removeEntries.run(this.root, directoryId);
      for (const { exif, kind, metadata, name } of entries) {
        this.insertEntry.run(
          this.root,
          directoryId,
          name,
          kind,
          metadata?.size ?? null,
          metadata?.modifiedMs ?? null,
          metadata?.createdMs ?? null,
          metadata?.accessedMs ?? null,
          exif ? JSON.stringify(exif) : null,
        );
      }
      this.upsertFolder.run(this.root, directoryId, detail, entries.length, Date.now());
    });
  }

  /** Drops the listings of `directoryIds`. */
  forget(directoryIds: Iterable<string>): void {
    this.transaction(() => {
      for (const directoryId of directoryIds) {
        this.removeFolder.run(this.root, directoryId);
        this.removeEntries.run(this.root, directoryId);
      }
    });
  }

  /** Drops the listings of `folderId` and of every folder inside it. */
  forgetInside(folderId: string): void {
    this.transaction(() => {
      if (folderId === '.') {
        this.removeAllFolders.run(this.root);
        this.removeAllEntries.run(this.root);
        return;
      }
      this.removeFolder.run(this.root, folderId);
      this.removeEntries.run(this.root, folderId);
      const range = { root: this.root, ...inside(folderId) };
      this.removeFoldersInside.run(range);
      this.removeEntriesInside.run(range);
    });
  }

  private transaction(write: () => void) {
    this.attempt(() => {
      this.database.exec('BEGIN IMMEDIATE');
      try {
        write();
        this.database.exec('COMMIT');
      } catch (error) {
        this.database.exec('ROLLBACK');
        throw error;
      }
    }, 'write');
  }

  private attempt<Result>(action: () => Result, verb: 'read' | 'write'): Result | undefined {
    // Reads that were under way as the folder closed finish to no avail.
    if (!this.database.isOpen) {
      return undefined;
    }
    try {
      return action();
    } catch (error) {
      process.emitWarning(`Could not ${verb} a stored folder listing: ${String(error)}`);
      return undefined;
    }
  }
}
