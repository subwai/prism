import type { ReadError } from '@prism/shared';

/** A view's read of the folders it shows, as it goes. */
export interface IndexRun {
  /** Settles once every folder of the scope has been read. */
  done: Promise<unknown>;
  finished: boolean;
  errors: ReadError[];
  /** Why the scope's own folder could not be read. */
  error: string | null;
}

/** How a walk reads the folders of its scope. */
export interface IndexOptions {
  /**
   * Reads every folder in full, as a refresh does. Otherwise only the scope's own folder is, as it
   * is on show, and a folder inside it is left unread if it is unchanged (see `FolderStamp`), so
   * files rewritten in place there are found only as it is read otherwise: as it is opened, by a
   * full read, or by the watcher.
   */
  full?: boolean;
  /**
   * Leaves unread a folder the catalog notes was last read to the end at or after this time, as a
   * full read taken up again does for those read since it began, wherever they were read.
   */
  readSince?: number;
}

/** A read of one folder: what could not be read, and the folders found inside it. */
export interface FolderRead {
  subfolders: string[];
  errors: ReadError[];
  error: string | null;
  /** Nothing is there any more, as a folder moved, renamed or deleted leaves it. */
  missing: boolean;
}

/** Whether `error` says nothing is there, rather than that something there cannot be read. */
export function isMissing(error: unknown) {
  const { code } = error as NodeJS.ErrnoException;
  return code === 'ENOENT' || code === 'ENOTDIR';
}
