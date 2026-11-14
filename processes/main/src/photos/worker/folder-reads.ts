import type { ReadError } from '@prism/shared';

/** A view's read of the folders it shows, as it goes. */
export interface IndexRun {
  /**
   * Settles once the scope's own folder has been read, with its rows in the catalog, or could
   * not be.
   */
  first: Promise<unknown>;
  /** Settles once every folder of the scope has been read. */
  done: Promise<unknown>;
  finished: boolean;
  errors: ReadError[];
  /** Why the scope's own folder could not be read. */
  error: string | null;
}

/** A read of one folder: what could not be read, and the folders found inside it. */
export interface FolderRead {
  subfolders: string[];
  errors: ReadError[];
  error: string | null;
}
