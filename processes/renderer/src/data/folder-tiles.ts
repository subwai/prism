import {
  type FolderSummary,
  type PhotoEntry,
  readCoverSet,
  type TreeFolderCover,
  type TreeFolderTile,
} from '@prism/shared';

/**
 * Whether a folder's tile may not say all it will once the worker reads the folder: the catalog
 * has not worked it out, or not read the folder to the end, or the folder has no covers of its
 * own but folders inside that may lend some.
 */
export function unsettled(summary?: FolderSummary): boolean {
  return !summary || !summary.read || (summary.covers.length === 0 && summary.hasSubfolders);
}

/**
 * Whether a folder's tile says it holds folders, or `otherwise` until the catalog has read the
 * folder, as one it has not read holds nothing it knows of, which says nothing of its folders.
 */
export function holdsFolders(summary: FolderSummary | undefined, otherwise: boolean): boolean {
  return summary?.hasSubfolders || (summary?.read ? false : otherwise);
}

/** A cover as the skeleton names its thumbnail, as an entry. */
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
 * A folder's tile as the skeleton has it, whose covers are parsed, and made entries, the first
 * time something reads them: the tree shows a few dozen tiles of tens of thousands, and doing so
 * for every tile took most of the time applying a skeleton did. A class, as a getter of its own
 * for each tile, rather than its prototype's, took as long again. Its covers are not its own
 * property, so a copy of it made by spreading it has none.
 */
class SkeletonSummary implements FolderSummary {
  #covers: PhotoEntry[] | undefined;

  constructor(
    readonly hasEntries: boolean,
    readonly hasSubfolders: boolean,
    readonly read: boolean,
    /** The skeleton's covers, and where this tile's start in them, or -1 for none. */
    private readonly sets: string,
    private readonly at: number,
  ) {}

  get covers(): PhotoEntry[] {
    if (!this.#covers) {
      this.#covers = readCoverSet(this.sets, this.at).map((cover) => coverEntry(cover));
    }
    return this.#covers;
  }
}

/** The tile `tile` of a skeleton whose covers are `covers`; none if the catalog has yet to work it out. */
export function skeletonSummary(tile: TreeFolderTile, covers: string): FolderSummary | undefined {
  if (!tile) {
    return undefined;
  }
  const [hasEntries, hasSubfolders, at, read] = tile;
  return new SkeletonSummary(hasEntries, hasSubfolders, read, covers, at);
}
