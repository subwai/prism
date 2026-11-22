import type { ReadError, WalkProgress } from '@prism/shared';

/** A walk that reads the folders a view shows, as it goes. */
export interface IndexRun {
  /** Settles once every folder of the scope has been read. */
  done: Promise<unknown>;
  finished: boolean;
  errors: ReadError[];
  /** Why the scope's own folder could not be read. */
  error: string | null;
  /** How far the walk has got. */
  walk: Readonly<WalkProgress>;
}

/** How a walk reads the folders of its scope. */
export interface IndexOptions {
  /**
   * Reads every folder in full, as a refresh does. Otherwise only the scope's own folder is
   * always read, because it is on screen. A folder inside it is skipped if it is unchanged (see
   * `FolderStamp`), so a file rewritten in place there is only found when the folder is read some
   * other way: when it is opened, by a full read, or by the watcher.
   */
  fullRead?: boolean;
  /**
   * Skips a folder that the catalog says was last read to the end at or after this time. A full
   * read that is taken up again uses it to skip the folders read since it began, wherever they
   * were read.
   */
  readSince?: number;
}

/** A read of one folder: what could not be read, and the folders found inside it. */
export interface FolderRead {
  subfolders: string[];
  errors: ReadError[];
  error: string | null;
  /** Nothing is there any more, as when the folder was moved, renamed or deleted. */
  missing: boolean;
}
