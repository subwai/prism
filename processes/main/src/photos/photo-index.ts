import type { PhotoExif } from '@prism/shared';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';

// Raise this whenever the schema, or what a row holds, changes: the index is only a cache, so
// a version it does not know is dropped and read again from the photos.
const SCHEMA_VERSION = 1,
  // Writes wait this long, or for this many rows, to commit together.
  FLUSH_MS = 250,
  FLUSH_ROWS = 256,
  // Rows nothing has used for this long, such as of photos deleted meanwhile, are dropped.
  UNUSED_MS = 180 * 24 * 60 * 60 * 1000,
  // A hit marks its row as used this often at most, to spare a write for every lookup.
  TOUCH_AFTER_MS = 24 * 60 * 60 * 1000,
  // Several folders' workers share the file; one waits this long for another's write.
  BUSY_TIMEOUT_MS = 5000;

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

function connect(file: string): DatabaseSync {
  const database = new DatabaseSync(file, { timeout: BUSY_TIMEOUT_MS });
  try {
    database.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
    const { user_version: version } = database.prepare('PRAGMA user_version').get() as {
      user_version: number;
    };
    if (version !== SCHEMA_VERSION) {
      database.exec(`
        BEGIN IMMEDIATE;
        DROP TABLE IF EXISTS exif;
        CREATE TABLE exif (
          path TEXT PRIMARY KEY,
          identity TEXT,
          size INTEGER NOT NULL,
          modified_ms REAL NOT NULL,
          exif TEXT NOT NULL,
          used_ms INTEGER NOT NULL
        );
        CREATE INDEX exif_identity ON exif (identity);
        PRAGMA user_version = ${SCHEMA_VERSION};
        COMMIT;
      `);
    }
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}

/**
 * What the app has read from photos, kept on disk between sessions so it is read once rather
 * than every time a folder opens. It is a cache, never the source of truth: a row counts only
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
  }

  /**
   * Opens the index at `file`, starting afresh if it cannot be read, and keeping it in memory
   * for this session if it cannot be written either.
   */
  static open(file: string): PhotoIndex {
    try {
      mkdirSync(path.dirname(file), { recursive: true });
      return new PhotoIndex(connect(file));
    } catch {
      for (const suffix of ['', '-wal', '-shm']) {
        rmSync(`${file}${suffix}`, { force: true });
      }
    }
    try {
      return new PhotoIndex(connect(file));
    } catch (error) {
      process.emitWarning(`The photo index is kept in memory: ${String(error)}`);
      return new PhotoIndex(connect(':memory:'));
    }
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

  /** Forgets everything, so every photo is read again. */
  clear(): void {
    this.pending.clear();
    this.database.exec('DELETE FROM exif');
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
