import type { PhotoEntry } from '#photos';

/**
 * The folders the sidebar's tree opened or closed by hand, by ID, which it opens again as it
 * left them the next time the same folder opens.
 */
export type OpenedFolders = [id: string, open: boolean][];

/**
 * What names a folder's cover's thumbnail, as the tree shows it: `inode` is `null` where the
 * catalog has none, as for `PhotoMetadata`.
 */
export type SkeletonCover = [
  id: string,
  kind: 'image' | 'video',
  size: number,
  modifiedMs: number,
  inode: string | null,
];

/**
 * A folder's tile as the skeleton has it: whether it holds anything, and whether any of it is a
 * folder, and its covers, an index into the skeleton's `covers`, or -1 for none. `null` if the
 * catalog has yet to work it out.
 */
export type SkeletonTile = [hasEntries: boolean, hasSubfolders: boolean, covers: number] | null;

/**
 * The folders of a library as the catalog knows them, for the sidebar's tree, which shows them
 * without asking the disk: each as `[id, parentId, name, tile]`, siblings by name, and which of
 * them were read to the end, whose subfolders are all it lists, in `listed`. Read for the whole
 * library, or for the subfolders of some folders. Folders that borrow their covers share them
 * with the folder they come from, so `covers` holds each set of covers once. In a library where
 * many folders hold only folders, such as events split into JPG and RAW, that makes a skeleton
 * of 34,000 folders a fifth smaller, 8.6 MB rather than 11 MB.
 */
export interface FolderSkeleton {
  folders: [id: string, parentId: string, name: string, tile: SkeletonTile][];
  /**
   * The library's folder's tile, and whether it was read to the end, in every skeleton, as no
   * folder holds it to list it in `folders`.
   */
  root: [tile: SkeletonTile, read: boolean];
  covers: SkeletonCover[][];
  listed: string[];
}

/** What a folder's tile shows of what is inside it, as the catalog knows it. */
export interface FolderSummary {
  hasEntries: boolean;
  hasSubfolders: boolean;
  /**
   * Up to four photos and videos to show as its cover, best first, and the next whenever one has
   * no thumbnail: its own, or, with none of its own, those of the first folder inside it, by
   * name, that has any.
   */
  covers: PhotoEntry[];
  /** The catalog read the folder to the end, so what it says of it is all the folder holds. */
  read: boolean;
}
