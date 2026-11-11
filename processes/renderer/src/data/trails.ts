import type { LibrarySession } from '#data/library';
import { subfolders } from '#data/subfolders';
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

/**
 * Whether `id` is the folder `folderId` or inside it, however deep. IDs are paths from the
 * library's root, `rootId`, separated however the system separates them.
 */
export function isWithin(rootId: string, folderId: string, id: string): boolean {
  if (folderId === rootId || id === folderId) {
    return true;
  }
  const separator = id[folderId.length];
  return id.startsWith(folderId) && (separator === '/' || separator === '\\');
}

/**
 * The folders from `library`'s root down to `id`, reading the listings on the way that are not
 * read yet, as on a launch; `null` if no folder inside the library is `id`.
 */
export async function readTrail(library: LibrarySession, id: string): Promise<FolderTrail | null> {
  const rootId = library.root.id;
  let reading = rootId;
  for (;;) {
    const trail = library.trail(id);
    if (trail) {
      return trail;
    }
    // oxlint-disable-next-line no-await-in-loop -- Each folder is in the listing above it.
    const next = subfolders(await library.directory(reading)).find((folder) =>
      isWithin(rootId, folder.id, id),
    );
    if (!next) {
      return null;
    }
    reading = next.id;
  }
}
