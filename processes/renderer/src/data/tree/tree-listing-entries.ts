/**
 * Turns a `TreeListing` into the entries the tree shows. This is the only place in the window
 * that reads the listing's tuples by position (see `@prism/shared`'s `tree-listing.ts`). It reads
 * them without making an object per field, as it runs for every folder of the library: 43,000 of
 * them in about 4 ms.
 */
import {
  type FolderSummary,
  type PhotoEntry,
  readCoverSet,
  type TreeFolderCover,
  type TreeFolderTile,
  type TreeListing,
} from '@prism/shared';

/** A cover from the listing, as an entry its thumbnail can be found by. */
function coverEntry([id, kind, size, modifiedMs, inode]: TreeFolderCover): PhotoEntry {
  // IDs are paths, separated however the system separates them.
  const end = Math.max(id.lastIndexOf('/'), id.lastIndexOf('\\'));
  const name = id.slice(end + 1);
  const parentId = end === -1 ? '.' : id.slice(0, end);
  const metadata: PhotoEntry['metadata'] = { accessedMs: 0, createdMs: 0, modifiedMs, size };
  if (inode !== null) {
    metadata.inode = inode;
  }
  return { id, kind, metadata, name, parentId };
}

/**
 * A folder's tile from the listing. Its covers are parsed, and made into entries, only the first
 * time something reads them: the tree shows a few dozen tiles of tens of thousands, and parsing
 * every tile's took most of the time applying a listing did.
 *
 * `covers` is a getter on the class rather than on each object, because a getter per object took
 * as long again. Since it is not an own property, a copy made by spreading a summary has no covers.
 */
class ListedFolderSummary implements FolderSummary {
  #covers: PhotoEntry[] | undefined;

  constructor(
    readonly hasEntries: boolean,
    readonly hasSubfolders: boolean,
    readonly read: boolean,
    /** The listing's covers, as text. */
    private readonly coverSets: string,
    /** Where this tile's covers start in `coverSets`, or `NO_COVERS`. */
    private readonly coversAt: number,
  ) {}

  get covers(): PhotoEntry[] {
    if (!this.#covers) {
      this.#covers = readCoverSet(this.coverSets, this.coversAt).map((cover) => coverEntry(cover));
    }
    return this.#covers;
  }
}

/** The summary of `tile`, whose covers are in `covers`; none while the catalog has yet to work it out. */
function listedFolderSummary(tile: TreeFolderTile, covers: string): FolderSummary | undefined {
  if (!tile) {
    return undefined;
  }
  const [hasEntries, hasSubfolders, coversAt, read] = tile;
  return new ListedFolderSummary(hasEntries, hasSubfolders, read, covers, coversAt);
}

/**
 * The listing's folders as entries with their tiles, under the ID of the folder holding them, and
 * the tile of the library's own folder. The listing already has them in this order, so only the
 * entries need making.
 */
export function entriesFromListing({ folders, covers, root }: TreeListing): {
  children: Map<string, PhotoEntry[]>;
  root: FolderSummary | undefined;
} {
  const children = new Map(
    folders.map(([parentId, subfolders]) => [
      parentId,
      subfolders.map(([id, name, tile]) => {
        const entry: PhotoEntry = { id, kind: 'directory', name, parentId };
        const summary = listedFolderSummary(tile, covers);
        if (summary) {
          entry.summary = summary;
        }
        return entry;
      }),
    ]),
  );
  return { children, root: listedFolderSummary(root, covers) };
}
