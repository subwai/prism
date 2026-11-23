import { isMissing } from '#photos/worker/disk/fs-errors';
import { readFolderStamp } from '#photos/worker/disk/read-folder';
import type { CurrentPriority, Scheduler } from '#photos/worker/scheduler/scheduler';
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

/** Whether `folderId` has a stamp in the catalog, and is on disk as the stamp says. */
async function matchesStamp({ catalog, root }: StampSources, folderId: string) {
  const [stored, now] = await Promise.all([
    catalog.call('folderStamp', folderId),
    readFolderStamp(root, folderId),
  ]);
  return stored !== null && sameStamp(stored, now);
}

/**
 * Whether `folderId` still holds what the catalog has of it, judged by one look at the folder's
 * own times at `priority`; see `FolderStamp`. Files rewritten in place do not show up this way.
 * - Returns `false` if the look fails, so a read then finds what is wrong and reports it.
 * - A folder skipped this way does not count as read this session, so the window still reads
 *   it when it asks for it.
 */
export function isUnchanged(
  sources: StampSources,
  folderId: string,
  priority: CurrentPriority,
): Promise<boolean> {
  return sources.scheduler
    .run('folder', `stamp ${folderId}`, priority, async () => {
      try {
        return await matchesStamp(sources, folderId);
      } catch (error) {
        // Over SMB on macOS, a folder whose name ends in a dot or a space is listed in its parent
        // but cannot be looked at or read by its path, so it never has a stamp. While the
        // parent's stamp holds, the parent still lists it, and a read of it would fail just as
        // the last one did. So it counts as unchanged if its parent is. The parent is looked at
        // after it, so if the folder went away in between, the parent's times moved.
        if (folderId === '.' || !isMissing(error)) {
          throw error;
        }
        return matchesStamp(sources, path.dirname(folderId));
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
