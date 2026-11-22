import { isMissing } from '#photos/worker/fs-errors';
import { entryKindOf, metadataOf } from '#photos/worker/indexer/read-folder';
import type { PhotoEntry } from '@prism/shared';
import type { Stats } from 'node:fs';
import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';

/**
 * Whether `file` exists under this exact spelling. A disk that ignores case, as macOS's and
 * Windows' do by default, still finds `photo.jpg` after it was renamed `Photo.jpg`. Only the
 * real path spells the name as the folder lists it.
 */
async function isListedUnderOwnName(file: string) {
  try {
    return path.basename(await realpath(file)) === path.basename(file);
  } catch {
    return false;
  }
}

/**
 * The entry at `id` inside `root` as a read of its folder would list it, or `null` if there is
 * nothing to list. Rejects for any other failure, such as a volume that does not answer, because
 * that says nothing about whether the entry is there.
 */
export async function entryOnDisk(
  root: string,
  id: string,
  parentId: string,
): Promise<PhotoEntry | null> {
  const file = path.join(root, id);
  let info: Stats;
  try {
    info = await lstat(file);
  } catch (error) {
    if (isMissing(error)) {
      return null;
    }
    throw error;
  }
  if (info.isSymbolicLink() || !(await isListedUnderOwnName(file))) {
    return null;
  }
  const name = path.basename(id);
  return { id, kind: entryKindOf(name, info), metadata: metadataOf(info), name, parentId };
}
