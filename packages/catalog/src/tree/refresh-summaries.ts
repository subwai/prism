import { contentsOf, mediaIn } from '#data/contents';
import type { CatalogDatabase } from '#data/database';
import {
  firstLenderCovers,
  librarySummary,
  type StoredSummary,
  storeLibrarySummary,
  storeSummary,
  summaryAt,
  tilesAt,
} from '#data/folder-summaries';
import { entriesByNumber } from '#data/items';
import { type StoredRatings, withStoredRatings } from '#stored-ratings';
import type { FolderSummary, PhotoEntry } from '@prism/shared';
import path from 'node:path';

// Enough to get past a few files that turn out to have no picture.
const MAX_COVERS = 4;

/**
 * The tile of `folderId` from what the catalog holds now. A folder with no photos or videos of its
 * own borrows the covers of the first folder directly inside it, by name, that has any, own or
 * borrowed, as stored: `firstLenderCovers` is the one place that chooses which folder lends, so
 * the rule is easy to change.
 */
function summaryNow(db: CatalogDatabase, library: number, folderId: string): StoredSummary {
  const contents = contentsOf(db, library, folderId);
  const own = contents.hasEntries ? mediaIn(db, library, folderId, MAX_COVERS) : [];
  const covers =
    own.length > 0 || !contents.hasSubfolders ? own : firstLenderCovers(db, library, folderId);
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

/** How deep `id` is in its library, the library's folder `.` being 0. */
function depthOf(id: string) {
  return id === '.' ? 0 : id.split(path.sep).length;
}

/**
 * Works out the tiles of `folderIds` again, on the writer, as a write changed what they hold,
 * and passes covers up: a folder whose covers changed has its parent worked out again, and so on
 * up until a folder's covers stay as they were. Covers that are the same entries still changed
 * if one of their files was `rewritten`, as its thumbnail did. The deepest go first, so each
 * folder is worked out once, after every folder inside it that changed. A folder borrows only
 * from what its subfolders have stored, so it never reads further down. Returns the folders
 * whose tiles changed, or that were newly `read` to the end, which the tree shows as part of the
 * tile, which the sidebar's tree reads again: the library's folder `.` among them if its own did.
 */
export function refreshSummaries(
  db: CatalogDatabase,
  library: number,
  folderIds: Iterable<string>,
  rewritten: ReadonlySet<number> = new Set(),
  read: ReadonlySet<string> = new Set(),
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
  /** Whether the tile of `folderId` shows otherwise than `stored` once it is `now`. */
  function changed(folderId: string, stored: StoredSummary | null, now: StoredSummary) {
    return !sameSummary(stored, now) || redrawn(now) || read.has(folderId);
  }
  /** Whether `summary` shows a file `rewritten`, whose thumbnail changed. */
  function redrawn(summary: StoredSummary) {
    return summary.covers.some((item) => rewritten.has(item));
  }
  const retiled: string[] = [];
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
      retiled.push(folderId);
      if (redrawn(now) || !sameCovers(row.summary?.covers, now.covers)) {
        add(row.parentId);
      }
    }
  }
  // The library's folder, last: no folder holds it, so the library's row keeps its tile.
  if (byDepth.has(0)) {
    const now = summaryNow(db, library, '.');
    if (changed('.', librarySummary(db, library), now)) {
      storeLibrarySummary(db, library, now);
      retiled.push('.');
    }
  }
  return retiled;
}

/**
 * `found` with each folder's tile, as the catalog keeps it on its row, its covers read by their
 * numbers in the same read so they show their files as they are now, and their ratings.
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

/** The tile of `folderId`, as the writer keeps it; `null` if there is none yet. */
export function tileOf(
  db: CatalogDatabase,
  library: number,
  folderId: string,
): StoredSummary | null {
  return tilesAt(db, library, [folderId])[0]?.summary ?? null;
}
