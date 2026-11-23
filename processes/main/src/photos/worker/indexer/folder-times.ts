import { isNotFoundOrNotAFolder } from '#photos/worker/disk/fs-errors';
import { readFolderTimes } from '#photos/worker/disk/read-folder';
import type { CurrentPriority, Scheduler } from '#photos/worker/scheduler/scheduler';
import type { Catalog, FolderTimes } from '@prism/catalog';
import path from 'node:path';

// A file's inode is its number on its disk, which a rename or move keeps.

interface FolderTimesSources {
  catalog: Catalog;
  root: string;
  scheduler: Scheduler;
}

/** Whether `left` and `right` say a folder is as it was. */
function sameFolderTimes(left: FolderTimes, right: FolderTimes) {
  return (
    left.modifiedMs === right.modifiedMs &&
    left.changedMs === right.changedMs &&
    left.inode === right.inode
  );
}

/** Whether `folderId` has folder times in the catalog, and is on disk as the folder times say. */
async function matchesFolderTimes({ catalog, root }: FolderTimesSources, folderId: string) {
  const [stored, now] = await Promise.all([
    catalog.call('folderTimes', folderId),
    readFolderTimes(root, folderId),
  ]);
  return stored !== null && sameFolderTimes(stored, now);
}

/**
 * Whether `folderId` still holds what the catalog has of it, judged by one look at the folder's
 * own times at `priority`; see `FolderTimes`. Files rewritten in place do not show up this way.
 * - Returns `false` if the look fails, so a read then finds what is wrong and reports it.
 * - A folder skipped this way does not count as read this session, so the window still reads
 *   it when it asks for it.
 */
export function isUnchanged(
  sources: FolderTimesSources,
  folderId: string,
  priority: CurrentPriority,
): Promise<boolean> {
  return sources.scheduler
    .run('folder', `folder times ${folderId}`, priority, async () => {
      try {
        return await matchesFolderTimes(sources, folderId);
      } catch (error) {
        // A folder SMB can't look up never has folder times (see "Names SMB can't look up" in
        // disk/read-folder.ts). While the parent's folder times hold, the parent still lists it,
        // and a read of it would fail just as the last one did. So it counts as unchanged if its
        // parent is. The parent is looked at after it, so if the folder went away in between, the
        // parent's times moved.
        if (folderId === '.' || !isNotFoundOrNotAFolder(error)) {
          throw error;
        }
        return matchesFolderTimes(sources, path.dirname(folderId));
      }
    })
    .catch(() => false);
}

/**
 * Whether the catalog notes `folderId` was last read to the end, with nothing failing, at or
 * after `sinceMs`, wherever it was read: by the window, a check or a full read.
 */
export async function wasReadSince(
  catalog: Catalog,
  folderId: string,
  sinceMs: number,
): Promise<boolean> {
  const readMs = await catalog.call('folderReadMs', folderId);
  return readMs !== null && readMs >= sinceMs;
}
