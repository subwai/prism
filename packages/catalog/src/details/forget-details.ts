import { catalogDatabase, transaction } from '#database/catalog-database';
import { connectIndex } from '#database/photo-index';
import { forgetAllDetails } from '#repositories/items/details';
import { dropRemovedDetails } from '#repositories/removed-details';

/**
 * Forgets everything read from inside photos, so every photo is read again. The catalog keeps
 * its entries, so views still show them meanwhile.
 */
export function forgetDetails(file: string): void {
  const database = connectIndex(file);
  try {
    const db = catalogDatabase(database);
    transaction(db, () => {
      dropRemovedDetails(db);
      forgetAllDetails(db);
    });
  } finally {
    database.close();
  }
}
