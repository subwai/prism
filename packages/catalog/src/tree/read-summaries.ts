import type { CatalogDatabase } from '#data/database';
import { type StoredSummary, tilesAt } from '#data/folder-summaries';
import { entriesByNumber } from '#data/items';
import { type StoredRatings, withStoredRatings } from '#stored-ratings';
import type { FolderSummary, PhotoEntry } from '@prism/shared';

/**
 * Returns `found` with each folder's tile, read from the folder's row. The tile stores
 * its covers as entry numbers, so this looks them up in the same call. That way the covers show
 * their files and ratings as they are now.
 */
export function withSummaries(
  db: CatalogDatabase,
  library: number,
  stored: StoredRatings,
  found: PhotoEntry[],
): PhotoEntry[] {
  const folderIds = found.filter((entry) => entry.kind === 'directory').map((entry) => entry.id);
  if (folderIds.length === 0) {
    return found;
  }
  const tiles = new Map(
    tilesAt(db, library, folderIds).flatMap(({ id, read, summary }) =>
      summary ? [[id, { read, summary }] as const] : [],
    ),
  );
  const numbers = [...new Set([...tiles.values()].flatMap(({ summary }) => summary.covers))];
  const byNumber = entriesByNumber(db, numbers);
  // Videos keep their ratings in the ratings file, as folders do.
  const rated = withStoredRatings(stored, [...byNumber.values()]);
  const covers = new Map([...byNumber.keys()].map((item, at) => [item, rated[at]]));
  return found.map((entry) => {
    const tile = tiles.get(entry.id);
    if (!tile) {
      return entry;
    }
    const summary: FolderSummary = {
      covers: tile.summary.covers.flatMap((item) => covers.get(item) ?? []),
      hasEntries: tile.summary.hasEntries,
      hasSubfolders: tile.summary.hasSubfolders,
      read: tile.read,
    };
    return { ...entry, summary };
  });
}

/** The tile of `folderId`, as the writer stores it; `null` if it isn't worked out yet. */
export function tileOf(
  db: CatalogDatabase,
  library: number,
  folderId: string,
): StoredSummary | null {
  return tilesAt(db, library, [folderId])[0]?.summary ?? null;
}
