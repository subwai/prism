import type { PhotoEntry } from '#photos';

/**
 * The folders the user opened or closed by hand in the sidebar's tree, by ID. The tree restores
 * them the next time the same library opens.
 */
export type OpenedFolders = [id: string, open: boolean][];

/** What a folder's tile shows about what is inside it, as the catalog knows it. */
export interface FolderSummary {
  hasEntries: boolean;
  hasSubfolders: boolean;
  /**
   * Up to four photos and videos to show as the folder's cover, best first. If one has no
   * thumbnail, the next one takes its place. They come from the folder itself or, if it has no
   * photos of its own, from the first folder inside it, by name, that has some.
   */
  covers: PhotoEntry[];
  /** Whether the catalog has read the whole folder, so this summary is final. */
  read: boolean;
}
