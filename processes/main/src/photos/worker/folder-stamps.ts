import { isMissing } from '#photos/worker/folder-reads';
import { stampOf } from '#photos/worker/read-folder';
import type { Scheduler, Want } from '#photos/worker/scheduler';
import type { Catalog, FolderStamp } from '@prism/catalog';
import path from 'node:path';

interface StampSources {
  catalog: Catalog;
  root: string;
  scheduler: Scheduler;
}

/** Whether `left` and `right` say a folder is as it was. */
function sameStamp(left: FolderStamp, right: FolderStamp) {
  return (
    left.modifiedMs === right.modifiedMs &&
    left.changedMs === right.changedMs &&
    left.inode === right.inode
  );
}

/** Whether `folderId` has a stamp, and is on disk as it says. */
async function isAsStamped({ catalog, root }: StampSources, folderId: string) {
  const [kept, now] = await Promise.all([
    catalog.call('folderStamp', folderId),
    stampOf(root, folderId),
  ]);
  return kept !== null && sameStamp(kept, now);
}

/**
 * Whether `folderId` holds what the catalog has of it, but for files rewritten in place, by one
 * look at the folder's own times, as `wants` says; see `FolderStamp`. `false` if the look fails,
 * as a read then finds what is wrong, and says so. A folder left unread so is not counted as
 * read this session, so the window, asking for it, still reads it.
 */
export function isUnchanged(
  sources: StampSources,
  folderId: string,
  wants: Want,
): Promise<boolean> {
  return sources.scheduler
    .run('folder', `stamp ${folderId}`, wants, async () => {
      try {
        return await isAsStamped(sources, folderId);
      } catch (error) {
        // Over SMB on macOS, a folder whose name ends in a dot or a space is listed in its parent
        // but cannot be looked at, or read, by its path, so it never has a stamp. While its
        // parent's stamp holds, the parent lists it still, so a read of it would fail as the last
        // did: it is as unchanged as anything there can be found to be. Its parent is looked at
        // after it, so one gone in between moved the parent's times.
        if (folderId === '.' || !isMissing(error)) {
          throw error;
        }
        return isAsStamped(sources, path.dirname(folderId));
      }
    })
    .catch(() => false);
}
