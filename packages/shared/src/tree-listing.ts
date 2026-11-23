/**
 * A compact format for the sidebar's folder tree. It uses tuples rather than objects with named
 * fields, because a library can have tens of thousands of folders and the tree is sent between
 * processes whole.
 */

/**
 * What a folder's cover needs to find its thumbnail in the cache. `inode` is `null` when the
 * catalog does not know it, as in `PhotoMetadata`.
 */
export type TreeFolderCover = [
  id: string,
  kind: 'image' | 'video',
  size: number,
  modifiedMs: number,
  inode: string | null,
];

/**
 * What a folder's tile shows, in short: whether it holds anything, whether any of that is a
 * folder, where its covers start in the listing's `covers` (`NO_COVERS` for none), and whether the
 * catalog has read the whole folder, so the tile is final. `null` while the catalog has not
 * worked it out yet.
 */
export type TreeFolderTile =
  | [hasEntries: boolean, hasSubfolders: boolean, covers: number, read: boolean]
  | null;

/** Where a tile's covers start in the listing's `covers` when it has none. */
export const NO_COVERS = -1;

/** A cover's fields, as `packCover` packs them. */
export interface CoverFields {
  id: string;
  kind: 'image' | 'video';
  size: number;
  modifiedMs: number;
  inode: string | null;
}

/** Packs a cover into the listing's tuple. */
export function packCover({ id, kind, size, modifiedMs, inode }: CoverFields): TreeFolderCover {
  return [id, kind, size, modifiedMs, inode];
}

/** A tile's fields, as `packTile` packs them. */
export interface TileFields {
  hasEntries: boolean;
  hasSubfolders: boolean;
  /** Where its covers start in the listing's `covers`, or `NO_COVERS`. */
  coversAt: number;
  read: boolean;
}

/** Packs a tile into the listing's tuple. */
export function packTile({
  hasEntries,
  hasSubfolders,
  coversAt,
  read,
}: TileFields): TreeFolderTile {
  return [hasEntries, hasSubfolders, coversAt, read];
}

/** Writes a set of covers as text for the listing's `covers`. `readCoverSet` reads it back. */
export function writeCoverSet(set: TreeFolderCover[]): string {
  return `${JSON.stringify(set)}\n`;
}

/** The set of covers that starts at `at` in the listing's `covers`. */
export function readCoverSet(covers: string, at: number): TreeFolderCover[] {
  if (at === NO_COVERS) {
    return [];
  }
  return JSON.parse(covers.slice(at, covers.indexOf('\n', at))) as TreeFolderCover[];
}

/** One folder in the tree, listed under the folder that holds it. */
export type TreeFolder = [id: string, name: string, tile: TreeFolderTile];

/**
 * Folders for the sidebar's tree, as the catalog knows them, so the tree never waits for the
 * disk. It holds either the whole library or the subfolders of some folders.
 *
 * Each folder's subfolders come sorted by name, the way the tree shows them, so the window can
 * use them as they are.
 *
 * A folder with no photos of its own borrows the covers of a folder inside it. To avoid
 * repeating them, `covers` holds each set of covers once, as the JSON of a `TreeFolderCover[]`
 * followed by a line break, and tiles point into it. The window parses a set only when a tile
 * on screen needs it: parsing all 150,000 covers of a 43,000-folder library up front took most
 * of the 100 ms that loading the tree took, for the few dozen tiles on screen.
 */
export interface SerializedTreeListing {
  folders: [parentId: string, subfolders: TreeFolder[]][];
  /** The tile of the library's own folder. It is in every listing, as no folder holds it. */
  root: TreeFolderTile;
  covers: string;
}

/**
 * Turns `listing` into text, to store or send between processes. The text is the JSON of its
 * folders, a line break, and then its covers unchanged, so reading the folders back never parses
 * the covers.
 */
export function treeListingToText({ folders, root, covers }: SerializedTreeListing): string {
  return `${JSON.stringify({ folders, root })}\n${covers}`;
}

/** Reads back a listing that `treeListingToText` turned into `text`. */
export function treeListingFromText(text: string): SerializedTreeListing {
  const end = text.indexOf('\n');
  const { folders, root } = JSON.parse(text.slice(0, end)) as Omit<SerializedTreeListing, 'covers'>;
  return { covers: text.slice(end + 1), folders, root };
}
