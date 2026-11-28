import { folderLocation } from '#photos/worker/disk/share/folder-location';
import { deleteOnVolume } from '#photos/worker/disk/trash/delete-on-volume';
import { deviceOf } from '#photos/worker/disk/trash/entry-moves';
import { PrismTrashBatch } from '#photos/worker/disk/trash/prism-trash-batch';
import { moveToSystemTrash } from '#photos/worker/disk/trash/system-trash';
import { errorMessage, type TrashedView, type TrashLocation } from '@prism/shared';

/** Where a run's entries go: the system's Trash, a batch of Prism's Trash, or nowhere. */
export interface TrashDestination {
  kind: TrashLocation['destination'];
  /** Moves `file` there, or deletes it; resolves with where it is now. */
  put: (file: string) => Promise<string>;
  /** The batch of Prism's Trash they go into, or `null` for the system's, or for none. */
  batch: string | null;
  /** Records what went, once the run ends, however it ends. */
  finish: () => Promise<void>;
}

/** The `finish` of a destination that records nothing. */
const NOTHING_TO_RECORD = () => Promise.resolve();

export const SYSTEM_TRASH: TrashDestination = {
  batch: null,
  finish: NOTHING_TO_RECORD,
  kind: 'system',
  put: moveToSystemTrash,
};

/** Where a run of the library at `root` goes when Prism can keep no Trash there: nowhere. */
export async function deleteForGood(root: string): Promise<TrashDestination> {
  const dev = await deviceOf(root);
  return {
    batch: null,
    finish: NOTHING_TO_RECORD,
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
  view?: TrashedView,
): Promise<TrashDestination> {
  if ((await folderLocation(root)) !== 'network') {
    return SYSTEM_TRASH;
  }
  try {
    const batch = await PrismTrashBatch.open(root, view && { view });
    return {
      batch: batch.dir,
      finish: () => batch.finish(),
      kind: 'prism',
      put: (file) => batch.put(file),
    };
  } catch (error) {
    throw new Error(`Prism can’t keep a Trash on this share: ${errorMessage(error)}`, {
      cause: error,
    });
  }
}
