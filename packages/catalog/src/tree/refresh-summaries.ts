import type { CatalogDatabase } from '#database/catalog-database';
import { contentsOf, mediaIn } from '#repositories/items/folder-contents';
import {
  firstSubfolderCovers,
  type StoredSummary,
  storeSummary,
  summaryAt,
} from '#repositories/items/folder-summaries';
import { librarySummary, storeLibrarySummary } from '#repositories/libraries';
import path from 'node:path';

// Enough to get past a few files that turn out to have no picture.
const MAX_COVERS = 4;

/**
 * Works out the tile of `folderId` from what the catalog holds now. A folder with no photos or
 * videos of its own uses the stored covers of its first subfolder, by name, that has any. Only
 * `firstSubfolderCovers` decides which subfolder that is, so the rule is easy to change.
 */
function summaryNow(db: CatalogDatabase, library: number, folderId: string): StoredSummary {
  const contents = contentsOf(db, library, folderId);
  const own = contents.hasEntries ? mediaIn(db, library, folderId, MAX_COVERS) : [];
  const covers =
    own.length > 0 || !contents.hasSubfolders ? own : firstSubfolderCovers(db, library, folderId);
  return { ...contents, covers };
}

function sameCovers(left: number[] | undefined, right: number[]) {
  return left?.length === right.length && left.every((item, at) => item === right[at]);
}

function sameSummary(left: StoredSummary | null, right: StoredSummary) {
  return (
    left?.hasEntries === right.hasEntries &&
    left.hasSubfolders === right.hasSubfolders &&
    sameCovers(left.covers, right.covers)
  );
}

/** How deep `id` is in its library. The library's own folder, `.`, is at depth 0. */
function depthOf(id: string) {
  return id === '.' ? 0 : id.split(path.sep).length;
}

/** What `refreshSummaries` works out again after a write. */
interface TouchedFolders {
  /** Folders whose tiles the write may have changed. */
  folderIds: Iterable<string>;
  /** Files whose thumbnails changed though they are the same entries. */
  rewritten: ReadonlySet<number>;
  /** Folders newly read to the end. */
  read: ReadonlySet<string>;
}

/**
 * Works out the tiles of `folderIds` again, on the writer, after a write changed what they hold.
 * Returns the folders whose tiles changed, including `.` for the library's own folder. The
 * sidebar's tree reads those again.
 *
 * A folder whose covers changed may change its parent's covers too, so its parent is worked out
 * next, and so on up until a folder's covers stay the same. The deepest folders go first, so each
 * folder is worked out once, after every changed folder inside it. A folder only uses what its
 * subfolders already stored, so it never has to look further down.
 *
 * A tile also counts as changed when:
 * - one of its covers is in `rewritten`, a file whose thumbnail changed though it is the same
 *   entry;
 * - the folder is in `read`: it was just read to the end, and the tile shows that.
 */
export function refreshSummaries(
  db: CatalogDatabase,
  library: number,
  { folderIds, read, rewritten }: TouchedFolders,
): string[] {
  const byDepth = new Map<number, Set<string>>();
  function add(id: string) {
    const depth = depthOf(id);
    const level = byDepth.get(depth) ?? new Set();
    level.add(id);
    byDepth.set(depth, level);
  }
  for (const id of folderIds) {
    add(id);
  }
  /** Whether the tile of `folderId` looks different once `stored` becomes `now`. */
  function changed(folderId: string, stored: StoredSummary | null, now: StoredSummary) {
    return !sameSummary(stored, now) || showsRewrittenFile(now) || read.has(folderId);
  }
  /** Whether `summary` shows a file in `rewritten`, whose thumbnail changed. */
  function showsRewrittenFile(summary: StoredSummary) {
    return summary.covers.some((item) => rewritten.has(item));
  }
  const changedTiles: string[] = [];
  for (let depth = Math.max(0, ...byDepth.keys()); depth > 0; depth -= 1) {
    for (const folderId of byDepth.get(depth) ?? []) {
      // A folder removed since has no row.
      const row = summaryAt(db, library, folderId);
      if (!row) {
        continue;
      }
      const now = summaryNow(db, library, folderId);
      if (!changed(folderId, row.summary, now)) {
        continue;
      }
      storeSummary(db, library, folderId, now);
      changedTiles.push(folderId);
      if (showsRewrittenFile(now) || !sameCovers(row.summary?.covers, now.covers)) {
        add(row.parentId);
      }
    }
  }
  // The library's own folder goes last. No folder holds it, so its tile is kept on the
  // library's row instead.
  if (byDepth.has(0)) {
    const now = summaryNow(db, library, '.');
    if (changed('.', librarySummary(db, library), now)) {
      storeLibrarySummary(db, library, now);
      changedTiles.push('.');
    }
  }
  return changedTiles;
}
