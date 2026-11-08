import { migrateIndex, NewerIndexError } from '#photos/index-migrations';
import { StoredListings } from '#photos/listing-store';
import type { PhotoExif } from '@prism/shared';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';

// Writes wait this long, or for this many rows, to commit together.
const FLUSH_MS = 250,
  FLUSH_ROWS = 256,
  // Rows nothing has used for this long, such as of photos deleted meanwhile, are dropped.
  UNUSED_MS = 180 * 24 * 60 * 60 * 1000,
  // A hit marks its row as used this often at most, to spare a write for every lookup.
  TOUCH_AFTER_MS = 24 * 60 * 60 * 1000,
  // Several folders' workers share the file; one waits this long for another's write.
  BUSY_TIMEOUT_MS = 5000;

/**
 * The index file's name. Its tables change through migrations, so it keeps this name; files of
 * the versions before them, such as `photo-index-v5.db`, are removed in time as stale caches.
 */
export const INDEX_FILE_NAME = 'photo-index.db';

/** What the index needs to know of a file on disk to tell whether a row is still current. */
export interface IndexedFile {
  /** The file's absolute path. */
  file: string;
  dev: number;
  ino: number;
  size: number;
  mtimeMs: number;
}

interface Row {
  path: string;
  identity: string | null;
  size: number;
  modified_ms: number;
  exif: string;
  used_ms: number;
}

/** The file's place on disk, which a rename keeps; some network disks report none. */
function identityOf({ dev, ino }: IndexedFile) {
  return ino ? `${dev}:${ino}` : null;
}

/** Opens the index at `file`, bringing its tables up to date. */
export function connectIndex(file: string): DatabaseSync {
  const database = new DatabaseSync(file, { timeout: BUSY_TIMEOUT_MS });
  try {
    database.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
    migrateIndex(database);
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}

/**
 * What the app has read from photos and folders, kept on disk between sessions so it is read
 * once rather than every time a folder opens. It is a cache, never the source of truth: a row counts only
 * while its file has the size and modification time it was read at, and losing the file loses
 * nothing but time. A file is found by its path, or by its place on disk once it was renamed.
 */
export class PhotoIndex {
  /** Writes waiting to commit, by path: the row, or `null` to remove it. */
  private readonly pending = new Map<string, Row | null>();
  private timer: NodeJS.Timeout | undefined;
  private closed = false;
  private readonly byPath: StatementSync;
  private readonly byIdentity: StatementSync;
  private readonly upsert: StatementSync;
  private readonly unlink: StatementSync;

  private constructor(private readonly database: DatabaseSync) {
    this.byPath = database.prepare('SELECT * FROM exif WHERE path = ?');
    this.byIdentity = database.prepare(
      'SELECT * FROM exif WHERE identity = ? AND size = ? AND modified_ms = ? LIMIT 1',
    );
    this.upsert = database.prepare(
      `INSERT OR REPLACE INTO exif (path, identity, size, modified_ms, exif, used_ms)
       VALUES (:path, :identity, :size, :modified_ms, :exif, :used_ms)`,
    );
    this.unlink = database.prepare('DELETE FROM exif WHERE path = ?');
    database.prepare('DELETE FROM exif WHERE used_ms < ?').run(Date.now() - UNUSED_MS);
    StoredListings.prune(database);
  }

  /**
   * Opens the index at `file`, starting afresh if it cannot be read, and keeping it in memory
   * for this session if it cannot be written either.
   */
  static open(file: string): PhotoIndex {
    try {
      mkdirSync(path.dirname(file), { recursive: true });
      return new PhotoIndex(connectIndex(file));
    } catch (error) {
      // A newer build's index is that build's to keep.
      if (!(error instanceof NewerIndexError)) {
        for (const suffix of ['', '-wal', '-shm']) {
          rmSync(`${file}${suffix}`, { force: true });
        }
      }
    }
    try {
      return new PhotoIndex(connectIndex(file));
    } catch (error) {
      process.emitWarning(`The photo index is kept in memory: ${String(error)}`);
      return new PhotoIndex(connectIndex(':memory:'));
    }
  }

  /** The folder listings of the library at `root`, the canonical path of the folder opened. */
  listings(root: string): StoredListings {
    return new StoredListings(this.database, root);
  }

  /** The EXIF details of `file`, if they were read while it was as it is now. */
  exif(file: IndexedFile): PhotoExif | undefined {
    const row = this.lookup(file);
    if (!row) {
      return undefined;
    }
    const now = Date.now();
    if (row.path !== file.file) {
      this.write(row.path, null);
    }
    if (row.path !== file.file || now - row.used_ms > TOUCH_AFTER_MS) {
      this.write(file.file, { ...row, path: file.file, used_ms: now });
    }
    return JSON.parse(row.exif) as PhotoExif;
  }

  /** Remembers what `file` held as it is now. */
  remember(file: IndexedFile, exif: PhotoExif): void {
    this.write(file.file, {
      exif: JSON.stringify(exif),
      identity: identityOf(file),
      modified_ms: file.mtimeMs,
      path: file.file,
      size: file.size,
      used_ms: Date.now(),
    });
  }

  private lookup(file: IndexedFile): Row | undefined {
    const queued = this.pending.get(file.file);
    const row = queued === undefined ? (this.byPath.get(file.file) as Row | undefined) : queued;
    if (row && row.size === file.size && row.modified_ms === file.mtimeMs) {
      return row;
    }
    // A file renamed or moved, inside the folder or into it, keeps its place on disk.
    const identity = identityOf(file);
    return identity === null
      ? undefined
      : (this.byIdentity.get(identity, file.size, file.mtimeMs) as Row | undefined);
  }

  /** Queues writing `row` at `file`, or removing what is there if `null`. */
  private write(file: string, row: Row | null) {
    // Reads that were under way as the folder closed finish to no avail.
    if (this.closed) {
      return;
    }
    this.pending.set(file, row);
    if (this.pending.size >= FLUSH_ROWS) {
      this.flush();
    } else {
      this.timer ??= setTimeout(() => this.flush(), FLUSH_MS);
    }
  }

  /** Commits the queued writes together. */
  flush(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.pending.size === 0) {
      return;
    }
    const writes = [...this.pending];
    this.pending.clear();
    try {
      this.database.exec('BEGIN IMMEDIATE');
      for (const [file, row] of writes) {
        if (row) {
          this.upsert.run({ ...row });
        } else {
          this.unlink.run(file);
        }
      }
      this.database.exec('COMMIT');
    } catch (error) {
      if (this.database.isTransaction) {
        this.database.exec('ROLLBACK');
      }
      // What was not written is read from the photos again next time.
      process.emitWarning(`Could not write the photo index: ${String(error)}`);
    }
  }

  /**
   * Forgets everything read from inside photos, and the listings, so every photo and folder is
   * read again. The catalog keeps its entries, so views still show them meanwhile.
   */
  clear(): void {
    this.pending.clear();
    this.database.exec(`
      DELETE FROM exif;
      DELETE FROM folders;
      DELETE FROM entries;
      DELETE FROM item_tags;
      UPDATE items SET exif_read = 0, taken_ms = NULL, camera = NULL, lens = NULL, exif = NULL
        WHERE exif_read <> 0;
    `);
  }

  /** The file the index is kept in, or `:memory:` for one only this session has. */
  get file(): string {
    return this.database.location() ?? ':memory:';
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.flush();
    this.closed = true;
    this.database.close();
  }
}
