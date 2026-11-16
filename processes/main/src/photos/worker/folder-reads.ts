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
   * Leaves a folder unread if it is unchanged, as at each launch; see `FolderStamp`. Files
   * rewritten in place are then found only as their folder is read otherwise, as for the window.
   */
  onlyChanged?: boolean;
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
