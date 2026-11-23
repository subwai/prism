import type { CatalogDatabase } from '#database/catalog-database';
import { deleteFoldersOfLibrary } from '#repositories/folders';
import { deleteIndexedFoldersOfLibrary } from '#repositories/indexed-folders';
import { deleteTagsOfLibrary } from '#repositories/item-tags';
import { deleteItemsOfLibrary } from '#repositories/items/entries';
import { deleteLibrary } from '#repositories/libraries';
import { deleteStoredTreeListing } from '#repositories/tree-listings';

/**
 * Removes `library` and everything the catalog holds of it. Its own row goes first, so its
 * photos' rows leave no details behind, as photos removed from a library do.
 */
export function removeLibrary(db: CatalogDatabase, library: number): void {
  deleteLibrary(db, library);
  deleteTagsOfLibrary(db, library);
  deleteItemsOfLibrary(db, library);
  deleteFoldersOfLibrary(db, library);
  deleteIndexedFoldersOfLibrary(db, library);
  deleteStoredTreeListing(db, library);
}
