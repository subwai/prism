import { folderLocation } from '#photos/worker/location';
import { PrismTrashBatch } from '#photos/worker/prism-trash';
import { errorMessage, type PrismTrashView, type TrashPlace } from '@prism/shared';
import { trashItem } from '@prism/trash';
import { lstat, readdir, rmdir, unlink } from 'node:fs/promises';
import path from 'node:path';

/** Where a run's entries go: the system's Trash, a batch of Prism's Trash, or nowhere. */
export interface TrashDestination {
  kind: TrashPlace['destination'];
  /** Moves `file` there, or deletes it; resolves with where it is now. */
  put: (file: string) => Promise<string>;
  /** The batch of Prism's Trash they go into, or `null` for the system's, or for none. */
  batch: string | null;
}

export const SYSTEM_TRASH: TrashDestination = { batch: null, kind: 'system', put: trashItem };

/**
 * Deletes `file` for good, and what is inside it, never crossing onto another volume than
 * `dev`, such as a share mounted inside it, whose files may have a Trash of their own.
 */
async function deleteOnVolume(file: string, dev: number): Promise<void> {
  const info = await lstat(file);
  if (info.dev !== dev) {
    throw new Error(`“${path.basename(file)}” is on another disk.`);
  }
  if (!info.isDirectory()) {
    await unlink(file);
    return;
  }
  for (const name of await readdir(file)) {
    await deleteOnVolume(path.join(file, name), dev);
  }
  await rmdir(file);
}

/** Where a run of the library at `root` goes when Prism can keep no Trash there: nowhere. */
export async function deleteForGood(root: string): Promise<TrashDestination> {
  const { dev } = await lstat(root);
  return {
    batch: null,
    kind: 'delete',
    put: async (file) => {
      await deleteOnVolume(file, dev);
      return file;
    },
  };
}

/**
 * Where a run of `view` of the library at `root` goes: the system's Trash, or, as a network
 * share has none, a new batch of Prism's Trash at the top of the share, which remembers `view`.
 */
export async function trashDestinationFor(
  root: string,
  view?: PrismTrashView,
): Promise<TrashDestination> {
  if ((await folderLocation(root)) !== 'network') {
    return SYSTEM_TRASH;
  }
  try {
    const batch = await PrismTrashBatch.open(root, view && { view });
    return { batch: batch.dir, kind: 'prism', put: (file) => batch.put(file) };
  } catch (error) {
    throw new Error(`Prism can’t keep a Trash on this share: ${errorMessage(error)}`, {
      cause: error,
    });
  }
}
