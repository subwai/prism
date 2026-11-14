import type { FolderSummary, PhotosAPI } from '@prism/shared';

// Folders on show whose tiles the worker should read are sent together, this long after the
// first, so a screenful of them is one call.
const TILE_READS_MS = 50;

/**
 * Whether a folder's tile may not say all it will once the worker reads the folder: the catalog
 * has not worked it out, or not read the folder to the end, or the folder has no covers of its
 * own but folders inside that may lend some.
 */
export function unsettled(summary?: FolderSummary): boolean {
  return !summary || !summary.read || (summary.covers.length === 0 && summary.hasSubfolders);
}

/**
 * Whether a folder's tile says it holds folders: `undefined` until the catalog has read the
 * folder, as one it has not read holds nothing it knows of, which says nothing of its folders.
 */
export function holdsFolders(summary?: FolderSummary): boolean | undefined {
  return summary?.hasSubfolders || (summary?.read ? false : undefined);
}

/**
 * The folders on show whose tiles the worker is to read, sent together in one call that answers
 * nothing; see `PhotosAPI.readTiles`. One that leaves the screen before they go is left out.
 */
export class TileReads {
  private readonly wanted = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly api: PhotosAPI) {}

  /** Asks for the tile of `folderId`; returns what to call once it is no longer on show. */
  want(folderId: string): () => void {
    this.wanted.add(folderId);
    this.timer ??= setTimeout(() => {
      this.timer = undefined;
      const folderIds = [...this.wanted];
      this.wanted.clear();
      // A tile not read is asked for again when next on show.
      this.api.readTiles(folderIds).catch(() => null);
    }, TILE_READS_MS);
    return () => {
      this.wanted.delete(folderId);
    };
  }

  close(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.wanted.clear();
  }
}
