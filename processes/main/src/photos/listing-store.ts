import type { Detail } from '#photos/read-folder';
import type { PhotoEntry } from '@prism/shared';
import path from 'node:path';
import type { DatabaseSync, StatementSync } from 'node:sqlite';

// Entries kept across every library, most recently used first. A listing of a few thousand
// photos takes a few hundred kilobytes, so this keeps the index to a few hundred megabytes.
const MAX_STORED_ENTRIES = 1_000_000,
  // A hit marks its listing as used this often at most, to spare a write for every read.
  TOUCH_AFTER_MS = 60 * 60 * 1000;

export interface StoredListing {
  detail: Detail;
  entries: PhotoEntry[];
}

interface Row {
  detail: Detail;
  entries: string;
  used_ms: number;
}

/**
 * The listings of one library's folders as complete reads found them, kept in the photo index
 * so they outlast the session. What was stored may have changed while the app was closed, so
 * whoever shows a stored listing reads the folder again to catch up. A write that fails only
 * means the folder is read from the disk next time, so failures are warnings rather than errors.
 */
export class StoredListings {
  private readonly select: StatementSync;
  private readonly upsert: StatementSync;
  private readonly touch: StatementSync;
  private readonly remove: StatementSync;
  private readonly removeInside: StatementSync;
  private readonly removeAll: StatementSync;

  constructor(
    private readonly database: DatabaseSync,
    private readonly root: string,
  ) {
    this.select = database.prepare(
      'SELECT detail, entries, used_ms FROM listings WHERE root = ? AND directory_id = ?',
    );
    this.upsert = database.prepare(
      `INSERT OR REPLACE INTO listings (root, directory_id, detail, entries, count, used_ms)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    this.touch = database.prepare(
      'UPDATE listings SET used_ms = ? WHERE root = ? AND directory_id = ?',
    );
    this.remove = database.prepare('DELETE FROM listings WHERE root = ? AND directory_id = ?');
    // Compares the start of the ID rather than using LIKE, which names may confuse with `%`.
    this.removeInside = database.prepare(
      `DELETE FROM listings WHERE root = :root
       AND (directory_id = :folder OR substr(directory_id, 1, length(:prefix)) = :prefix)`,
    );
    this.removeAll = database.prepare('DELETE FROM listings WHERE root = ?');
  }

  /** Drops the listings used longest ago, past the budget of entries kept in all. */
  static prune(database: DatabaseSync, budget = MAX_STORED_ENTRIES): void {
    database
      .prepare(
        `DELETE FROM listings WHERE rowid IN (
           SELECT rowid FROM (
             SELECT rowid, SUM(count) OVER (ORDER BY used_ms DESC, rowid) AS kept FROM listings
           ) WHERE kept > ?
         )`,
      )
      .run(budget);
  }

  get(directoryId: string): StoredListing | undefined {
    const row = this.attempt(
      () => this.select.get(this.root, directoryId) as Row | undefined,
      'read',
    );
    if (!row) {
      return undefined;
    }
    const now = Date.now();
    if (now - row.used_ms > TOUCH_AFTER_MS) {
      this.attempt(() => this.touch.run(now, this.root, directoryId), 'write');
    }
    return { detail: row.detail, entries: JSON.parse(row.entries) as PhotoEntry[] };
  }

  set(directoryId: string, { detail, entries }: StoredListing): void {
    this.attempt(
      () =>
        this.upsert.run(
          this.root,
          directoryId,
          detail,
          JSON.stringify(entries),
          entries.length,
          Date.now(),
        ),
      'write',
    );
  }

  /** Drops the listings of `directoryIds`. */
  forget(directoryIds: Iterable<string>): void {
    this.transaction(() => {
      for (const directoryId of directoryIds) {
        this.remove.run(this.root, directoryId);
      }
    });
  }

  /** Drops the listings of `folderId` and of every folder inside it. */
  forgetInside(folderId: string): void {
    this.attempt(() => {
      if (folderId === '.') {
        this.removeAll.run(this.root);
      } else {
        this.removeInside.run({
          folder: folderId,
          prefix: `${folderId}${path.sep}`,
          root: this.root,
        });
      }
    }, 'write');
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
