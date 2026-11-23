import type { CatalogDatabase } from '#database/catalog-database';
import { catalogEntriesByNumber, type CatalogEntry } from '#repositories/items/entries';
import { tilesAt } from '#repositories/items/folder-summaries';

/**
 * An entry of a view as the catalog last listed its file, and, for a folder, the first of the
 * covers its tile keeps, which its tile shows; a folder whose tile is not worked out has none.
 */
export interface ViewFile extends CatalogEntry {
  cover?: CatalogEntry;
}

/** The entries numbered `numbers`, in that order, with folders' covers, leaving out any gone. */
export function viewFiles(db: CatalogDatabase, library: number, numbers: number[]): ViewFile[] {
  const found = catalogEntriesByNumber(db, numbers);
  // Read afresh, so each can take its cover in place.
  const files: ViewFile[] = numbers.flatMap((item) => found.get(item) ?? []);
  const folderIds = files.filter((file) => file.kind === 'directory').map((file) => file.id);
  const firsts = new Map(
    tilesAt(db, library, folderIds).flatMap(({ id, summary }) => {
      const [first] = summary?.covers ?? [];
      return first === undefined ? [] : [[id, first] as const];
    }),
  );
  const covers = catalogEntriesByNumber(db, [...firsts.values()]);
  for (const file of files) {
    const cover = covers.get(firsts.get(file.id) ?? -1);
    if (cover) {
      file.cover = cover;
    }
  }
  return files;
}
