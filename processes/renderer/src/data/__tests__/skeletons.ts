import {
  type TreeFolder,
  type TreeFolderCover,
  type TreeFolderTile,
  type TreeListing,
  treeListingToText,
} from '@prism/shared';

/** A folder's tile as `skeletonOf` takes it: its covers are an index into the sets given. */
type TestTile = [hasEntries: boolean, hasSubfolders: boolean, covers: number, read: boolean] | null;

/**
 * The catalog's skeleton of `folders`, each as `[id, parentId, name, tile]`, siblings in order,
 * and of the library's folder's tile, `root`, whose covers are among `covers`.
 */
export function skeletonOf(
  folders: [id: string, parentId: string, name: string, tile: TestTile][],
  { covers = [], root = null }: { covers?: TreeFolderCover[][]; root?: TestTile } = {},
): TreeListing {
  const starts: number[] = [];
  let lines = '';
  for (const set of covers) {
    starts.push(lines.length);
    lines += `${JSON.stringify(set)}\n`;
  }
  const tileOf = (tile: TestTile): TreeFolderTile =>
    tile && [tile[0], tile[1], starts[tile[2]] ?? -1, tile[3]];
  const byParent = new Map<string, TreeFolder[]>();
  for (const [id, parentId, name, tile] of folders) {
    const siblings = byParent.get(parentId) ?? [];
    siblings.push([id, name, tileOf(tile)]);
    byParent.set(parentId, siblings);
  }
  return { covers: lines, folders: [...byParent], root: tileOf(root) };
}

/**
 * The skeleton of a large library on a share, as the catalog sends it, as large as a real one of
 * 43,000 folders: 44,000 folders, by year, event and day, with names and IDs as long as its, and
 * nearly every one with three or four covers of its own, 145,000 in all, 20 MB of text.
 */
export function largeSkeleton(): string {
  const folders: Parameters<typeof skeletonOf>[0] = [];
  const covers: TreeFolderCover[][] = [];
  const levels = [
    { count: 30, name: (at: number) => `Photos ${2000 + at}` },
    { count: 40, name: (at: number) => `${at} Event` },
    { count: 36, name: (at: number) => `2019-05-${String(at).padStart(2, '0')} Holiday trip` },
  ];
  let parents = ['.'];
  for (const [depth, level] of levels.entries()) {
    const next: string[] = [];
    for (const parentId of parents) {
      for (let at = 0; at < level.count; at += 1) {
        const made = folders.length;
        const name = level.name(at);
        const id = parentId === '.' ? name : `${parentId}/${name}`;
        // One folder in fourteen has no photos of its own, nor borrows any.
        const set = made % 14 === 0 ? -1 : covers.length;
        if (set !== -1) {
          covers.push(
            Array.from({ length: 3 + (made % 2) }, (_unused, cover): TreeFolderCover => {
              const number = String(made * 4 + cover).padStart(6, '0');
              const file = `${id}/DSC_${number} edited.JPG`;
              return [file, 'image', 8e6 + made, 16e11 + made, `${made}${cover}`];
            }),
          );
        }
        folders.push([id, parentId, name, [true, depth < levels.length - 1, set, true]]);
        next.push(id);
      }
    }
    parents = next;
  }
  return treeListingToText(skeletonOf(folders, { covers, root: [true, true, -1, true] }));
}

/** The folders at `ids` of `skeleton`, as the worker reads those whose tiles changed. */
export function tilesOf(skeleton: TreeListing, ids: string[]): TreeListing {
  return {
    ...skeleton,
    folders: skeleton.folders.map(([parentId, subfolders]) => [
      parentId,
      subfolders.filter(([id]) => ids.includes(id)),
    ]),
  };
}
