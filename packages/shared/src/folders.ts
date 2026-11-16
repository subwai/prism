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
 * folder, where its covers start in the skeleton's `covers`, or -1 for none, and whether the
 * catalog read it to the end, so what it says of it is all the folder holds. `null` if the
 * catalog has yet to work it out.
 */
export type SkeletonTile =
  | [hasEntries: boolean, hasSubfolders: boolean, covers: number, read: boolean]
  | null;

/** A folder as the skeleton has it, under the folder holding it. */
export type SkeletonFolder = [id: string, name: string, tile: SkeletonTile];

/**
 * The folders of a library as the catalog knows them, for the sidebar's tree, which shows them
 * without asking the disk. Read for the whole library, or for the subfolders of some folders.
 * Each folder holding folders comes with them, by name, as the tree keeps them, so the window
 * takes them as they are. Folders that borrow their covers share them with the folder they come
 * from, so `covers` holds each set of covers once, each as the JSON of a `SkeletonCover[]` and a
 * line break. The window parses a set only once a tile on show reads it: parsing the 150,000
 * covers of a library of 43,000 folders, and making entries of them, took most of the 100 ms
 * applying its skeleton did, for the few dozen tiles the tree shows.
 */
export interface FolderSkeleton {
  folders: [parentId: string, subfolders: SkeletonFolder[]][];
  /** The library's folder's tile, in every skeleton, as no folder holds it. */
  root: SkeletonTile;
  covers: string;
}

/**
 * `skeleton` as text, to keep and to send between processes: the JSON of its folders, a line
 * break, and its covers as they are, so they are not parsed with the folders.
 */
export function skeletonToText({ folders, root, covers }: FolderSkeleton): string {
  return `${JSON.stringify({ folders, root })}\n${covers}`;
}

/** The skeleton `skeletonToText` made `text` of. */
export function skeletonFromText(text: string): FolderSkeleton {
  const end = text.indexOf('\n');
  const { folders, root } = JSON.parse(text.slice(0, end)) as Omit<FolderSkeleton, 'covers'>;
  return { covers: text.slice(end + 1), folders, root };
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
