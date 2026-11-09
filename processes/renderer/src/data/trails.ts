import type { PhotoEntry, PhotoFolder, PhotoRoot } from '@prism/shared';

/** Folders from the library's root down to one inside it. */
export type FolderTrail = PhotoFolder[];

/** The folders from `root` down to `id`, through the folders known so far. */
export function trailIn(root: PhotoRoot, folders: ReadonlyMap<string, PhotoEntry>, id: string) {
  const trail: PhotoFolder[] = [];
  // However deep, a trail passes each known folder once at most.
  for (let current = id; current !== root.id;) {
    const folder = folders.get(current);
    if (!folder || trail.length > folders.size) {
      return null;
    }
    trail.push(folder);
    current = folder.parentId;
  }
  return [root, ...trail.toReversed()];
}
