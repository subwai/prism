import type { TrashEntry } from '@prism/shared';
import path from 'node:path';

/** Files that belong to the photo or video of the same name, and go with it. */
const SIDECAR_EXTENSIONS = new Set(['.aae', '.xmp']);
/** The prefix of the files macOS writes beside others on disks it cannot keep metadata on. */
export const APPLE_DOUBLE = '._';

function isMedia(entry: TrashEntry): boolean {
  return entry.kind === 'image' || entry.kind === 'video';
}

/** The entries `file` belongs to among its folder's: a sidecar's photo, or AppleDouble's file. */
export function ownersOf(file: TrashEntry, siblings: TrashEntry[]): TrashEntry[] {
  const name = file.name.toLocaleLowerCase();
  if (name.startsWith(APPLE_DOUBLE)) {
    const owner = name.slice(APPLE_DOUBLE.length);
    return siblings.filter((sibling) => sibling.name.toLocaleLowerCase() === owner);
  }
  const extension = path.extname(name);
  if (!SIDECAR_EXTENSIONS.has(extension)) {
    return [];
  }
  // `IMG_1.xmp` and `IMG_1.jpg.xmp` both belong to `IMG_1.jpg`.
  const stem = name.slice(0, -extension.length);
  return siblings.filter((sibling) => {
    const owner = sibling.name.toLocaleLowerCase();
    return isMedia(sibling) && (owner === stem || path.parse(owner).name === stem);
  });
}
