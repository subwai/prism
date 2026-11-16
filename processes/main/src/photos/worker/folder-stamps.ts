import { stampOf } from '#photos/worker/read-folder';
import type { Scheduler, Want } from '#photos/worker/scheduler';
import type { Catalog, FolderStamp } from '@prism/catalog';

/** Whether `left` and `right` say a folder is as it was. */
function sameStamp(left: FolderStamp, right: FolderStamp) {
  return (
    left.modifiedMs === right.modifiedMs &&
    left.changedMs === right.changedMs &&
    left.inode === right.inode
  );
}

/**
 * Whether `folderId` holds what the catalog has of it, but for files rewritten in place, by one
 * look at the folder's own times, as `wants` says; see `FolderStamp`. `false` if the look fails,
 * as a read then finds what is wrong, and says so. A folder left unread so is not counted as
 * read this session, so the window, asking for it, still reads it.
 */
export function isUnchanged(
  { catalog, root, scheduler }: { catalog: Catalog; root: string; scheduler: Scheduler },
  folderId: string,
  wants: Want,
): Promise<boolean> {
  return scheduler
    .run('folder', `stamp ${folderId}`, wants, async () => {
      const [kept, now] = await Promise.all([
        catalog.call('folderStamp', folderId),
        stampOf(root, folderId),
      ]);
      return kept !== null && sameStamp(kept, now);
    })
    .catch(() => false);
}
