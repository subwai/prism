import { type CatalogDatabase, transaction } from '#data/database';
import { countItems, librariesByUse, removeLibrary } from '#data/libraries';

// Items kept of the libraries not being opened, least recently used dropped first. A row and
// its index entries take about 400 bytes, so this keeps the index to a couple of gigabytes.
const MAX_OTHER_ITEMS = 5_000_000;

/**
 * Drops the libraries used longest ago, past a budget of entries kept of every library but the
 * one at `kept`, which is being opened and never dropped.
 */
export function pruneCatalog(db: CatalogDatabase, kept: string, budget = MAX_OTHER_ITEMS): void {
  let total = 0;
  const dropped = librariesByUse(db, kept).filter((library) => {
    total += countItems(db, library);
    return total > budget;
  });
  if (dropped.length === 0) {
    return;
  }
  transaction(db, () => {
    for (const library of dropped) {
      removeLibrary(db, library);
    }
  });
}
