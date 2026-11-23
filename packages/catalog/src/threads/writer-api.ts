import type { UnreadPhoto } from '#repositories/items/details';
import type { KnownItem } from '#repositories/items/entries';
import type { PhotoFile } from '#services/details/reusable-details';
import type { ViewOrder } from '#services/views/catalog-views';
import type { CatalogWrite } from '#services/writes/write-catalog';
import type { TreeChanges } from '#services/writes/write-result';
import type { BusyChange } from '#threads/busy-change';
import type { DetailsProgress, ForgetProgress, Rating } from '@prism/shared';

/** What the catalog's writer answers. */
export interface CatalogWriterAPI {
  /** The library's number in the catalog. The reader needs it to start. */
  library: () => number;
  write: (writes: CatalogWrite[]) => void;
  /**
   * Starts forgetting every photo's details, a batch at a time, so each is read again. One
   * already under way starts over.
   */
  forgetDetails: () => void;
  foldersInside: (directoryId: string) => string[];
  knownItemsIn: (directoryId: string) => KnownItem[];
  photosToRead: (limit: number) => UnreadPhoto[];
  /**
   * Reuses details the catalog already read for `photos`, from before a move or from another
   * library; see `findReusableDetails`. Returns the IDs of the photos it had none for, whose
   * files still have to be read.
   */
  reuseDetails: (photos: PhotoFile[]) => string[];
  /**
   * Leaves the photos numbered `items` out of `photosToRead` until a read lists them again. The
   * details reader skips photos whose details failed while the share was offline: they stay unread in
   * the catalog, so a later session tries them again.
   */
  skip: (items: number[]) => void;
  /**
   * Stores the rating of an entry that can't keep one in its own file, such as a folder or a
   * video. `null` removes it.
   */
  rate: (id: string, rating: Rating | null) => void;
  /**
   * Moves an entry's rows and stored ratings, and those of everything inside it, after the app
   * renamed or moved it. Returns `false` if the catalog can't move the rows, and then leaves them
   * as they are; see `moveInCatalog`.
   */
  move: (from: string, to: string) => boolean;
  /** Moves the stored ratings of an entry, and of everything inside it, as it is renamed. */
  moveRatings: (from: string, to: string) => void;
  /**
   * Counts the library's photos and how many have their details read, then keeps the count
   * current and reports it as it changes; see `keepDetailsCount`. The client calls it once the
   * reader has started, because counting reads every photo's row, which takes a second from a
   * cold disk. It is called again after another connection forgot every photo's details.
   */
  countDetails: () => void;
  /** The open views' orders, most recently used first, which `photosToRead` follows. */
  useOrders: (orders: ViewOrder[]) => void;
  /**
   * Every folder of the library, as the text of a `SerializedTreeListing`: the stored one, or one built
   * now. It is built here rather than on the reader, so the window's reads never wait for it.
   */
  listWholeTree: () => string;
}

/**
 * What the writer sends without being asked:
 * - a write committed, with whether it changed only photos' details (`onlyDetails`), how many of
 *   the library's photos are still `unread` once counted, and what changed in the tree;
 * - a large job started or stopped (`BusyChange`);
 * - how many of the library's photos have their details read, when that changes;
 * - how far forgetting every photo's details has got, and when it is done.
 */
export type WriterEvent =
  | ({ kind: 'changed'; onlyDetails: boolean; unread: number | undefined } & TreeChanges)
  | BusyChange
  | { kind: 'details'; details: DetailsProgress }
  /** How far forgetting every photo's details has got, after each batch. */
  | { kind: 'forgetting'; progress: ForgetProgress }
  /** Forgetting every photo's details is done. */
  | { kind: 'detailsForgotten' };
