import { contentsOf, mediaIn } from '#data/contents';
import type { CatalogDatabase } from '#data/database';
import {
  type StoredSummary,
  storeSummary,
  type SubfolderCovers,
  subfolderCovers,
  summaryAt,
  tilesAt,
  uncoveredFolders,
} from '#data/folder-summaries';
import { entriesByNumber } from '#data/items';
import { type StoredRatings, withStoredRatings } from '#stored-ratings';
import type { FolderSummary, PhotoEntry } from '@prism/shared';
import path from 'node:path';

// Enough to get past a few files that turn out to have no picture.
const MAX_COVERS = 4;
// A folder whose tile a read works out, as the writer has not yet, opens at most this many
// folders inside it to find covers, as the worker's reads of the disk do.
const MAX_LENDERS = 256;

/**
 * The covers a folder with no photos or videos of its own borrows: those of the first of its
 * `subfolders`, by name, that has any, own or borrowed. `coversOf` says what each has. The one
 * place that chooses which folder lends, so the rule is easy to change.
 */
function lentCovers(
  subfolders: SubfolderCovers[],
  coversOf: (subfolder: SubfolderCovers) => number[],
): number[] {
  for (const subfolder of subfolders) {
    const covers = coversOf(subfolder);
    if (covers.length > 0) {
      return covers;
    }
  }
  return [];
}

/** The tile of `folderId` from what the catalog holds now, with `coversOf` its subfolders'. */
function summaryNow(
  db: CatalogDatabase,
  library: number,
  folderId: string,
  coversOf: (subfolder: SubfolderCovers) => number[],
): StoredSummary {
  const contents = contentsOf(db, library, folderId);
  const own = contents.hasEntries ? mediaIn(db, library, folderId, MAX_COVERS) : [];
  const covers =
    own.length > 0 || !contents.hasSubfolders
      ? own
      : lentCovers(subfolderCovers(db, library, folderId), coversOf);
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
 * holding those whose tiles changed, whose subfolders the sidebar's tree reads again.
 */
export function refreshSummaries(
  db: CatalogDatabase,
  library: number,
  folderIds: Iterable<string>,
  rewritten: ReadonlySet<number> = new Set(),
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
  const holding = new Set<string>();
  for (let depth = Math.max(0, ...byDepth.keys()); depth > 0; depth -= 1) {
    for (const folderId of byDepth.get(depth) ?? []) {
      // The library's folder has no row, nor does one removed since.
      const row = summaryAt(db, library, folderId);
      if (!row) {
        continue;
      }
      const now = summaryNow(db, library, folderId, (subfolder) => subfolder.covers ?? []);
      const redrawn = now.covers.some((item) => rewritten.has(item));
      if (sameSummary(row.summary, now) && !redrawn) {
        continue;
      }
      storeSummary(db, library, folderId, now);
      holding.add(row.parentId);
      if (redrawn || !sameCovers(row.summary?.covers, now.covers)) {
        add(row.parentId);
      }
    }
  }
  return [...holding];
}

/**
 * Works out the tiles of up to `limit` folders that rows of a build before them left unknown, on
 * the writer, in the background. Returns how many it found, and the folders holding those whose
 * tiles changed, as `refreshSummaries` does.
 */
export function fillSummaries(
  db: CatalogDatabase,
  library: number,
  limit: number,
): { found: number; holding: string[] } {
  const folderIds = uncoveredFolders(db, library, limit);
  return { found: folderIds.length, holding: refreshSummaries(db, library, folderIds) };
}

/**
 * The tile of `folderId`, worked out as it is read, for a folder whose tile the writer has not
 * worked out yet, opening at most `budget.left` folders inside it whose own are unknown too.
 */
function workedOut(
  db: CatalogDatabase,
  library: number,
  folderId: string,
  budget: { left: number },
): StoredSummary {
  return summaryNow(db, library, folderId, (subfolder) => {
    if (subfolder.covers !== null) {
      return subfolder.covers;
    }
    if (budget.left <= 0) {
      return [];
    }
    budget.left -= 1;
    return workedOut(db, library, subfolder.id, budget).covers;
  });
}

/**
 * `found` with each folder's tile, as the catalog keeps it on its row, its covers read by their
 * numbers in the same read so they show their files as they are now, and their ratings. A
 * folder whose tile the writer has yet to work out, as one a build before them listed, has it
 * worked out here instead.
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
    tilesAt(db, library, folderIds).map((tile) => [
      tile.id,
      {
        read: tile.read,
        summary: tile.summary ?? workedOut(db, library, tile.id, { left: MAX_LENDERS }),
      },
    ]),
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

/** The tile of `folderId`, worked out here if the writer has yet to; `null` if there is none. */
export function tileOf(
  db: CatalogDatabase,
  library: number,
  folderId: string,
): StoredSummary | null {
  const [tile] = tilesAt(db, library, [folderId]);
  if (!tile) {
    return null;
  }
  return tile.summary ?? workedOut(db, library, folderId, { left: MAX_LENDERS });
}
