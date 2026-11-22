import type { Share } from '#photos/worker/share/share';
import type { Catalog, CatalogFiles } from '@prism/catalog';

/** Makes the catalog a library's folder keeps, in `files`. */
export type CatalogFactory = (files: CatalogFiles, root: string) => Catalog;

/** How `PhotoLibrary.open` opens a folder. Tests set the ones the app leaves out. */
export interface LibraryOptions {
  /** Where the catalog is kept; see `prepareIndex` and `prepareRatings`. In memory by default. */
  files?: CatalogFiles;
  /** Makes the catalog. The app keeps it on a thread of its own, and tests keep it on theirs. */
  connect?: CatalogFactory;
  /** The time now, which the catalog notes each folder was read at. */
  now?: () => number;
  /** Whether the folder can be reached, or its volume, such as a share, is offline. */
  share?: Share;
}

/** Files kept for this session only, as tests keep them. */
export const IN_MEMORY: CatalogFiles = { index: ':memory:', ratings: ':memory:' };
