import { isNotFoundOrNotAFolder } from '#photos/worker/disk/fs-errors';
import type { FolderTimes } from '@prism/catalog';
import { INDEX_CONCURRENCY, inodeOf, listable, mediaKind } from '@prism/media';
import { errorMessage, type PhotoEntry, type PhotoMetadata, type ReadError } from '@prism/shared';
import type { Stats } from 'node:fs';
import { lstat, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import pLimit from 'p-limit';

// `stat` reads what the disk records of a file: its size, its times and its number on the disk.
// `lstat` does the same as `stat`, but for a link itself rather than what it points to.
// A file's inode is its number on its disk, which a rename or move keeps.

// Names SMB can't look up: over SMB on macOS, a name that ends in a dot or a space is listed
// in its folder, but looking at it by its path says nothing is there. Such an entry never has
// its size and times, and such a folder never has folder times and can't be read. The read below
// doesn't count that against its folder, `isUnchanged` judges such a folder by its parent, and
// `hasChanged` keeps what the catalog had of such an entry.

// Metadata is read this many files at a time.
const STAT_BATCH = 64;

/**
 * Limits the file calls of every folder being read to the threads kept for them. The rest wait here
 * instead of in the queue of libuv, the library Node runs file calls on, where they would get ahead
 * of the calls that find thumbnails; see `INDEX_CONCURRENCY`.
 */
const fileCalls = pLimit(INDEX_CONCURRENCY);

/** What `readFolder` yields: an entry, an entry that could not be read, or, last, the folder's times. */
export type ReadItem =
  | { kind: 'entry'; entry: PhotoEntry }
  | { kind: 'error'; error: ReadError }
  | { kind: 'folder-times'; times: FolderTimes };

/** What an entry named `name` is, as a read of its folder or `stat` describes it. */
export function entryKindOf(
  name: string,
  node: { isDirectory: () => boolean; isFile: () => boolean },
): PhotoEntry['kind'] {
  if (node.isDirectory()) {
    return 'directory';
  }
  return (node.isFile() && mediaKind(name)) || 'file';
}

/** A file's size and times, as the catalog keeps them. */
export function metadataOf(info: Stats): PhotoMetadata {
  return {
    accessedMs: info.atimeMs,
    createdMs: info.birthtimeMs,
    inode: inodeOf(info),
    modifiedMs: info.mtimeMs,
    size: info.size,
  };
}

/** The times of the folder at `directory` as it is on disk now; see `FolderTimes`. A link has its own. */
async function readFolderTimesAt(directory: string): Promise<FolderTimes> {
  const info = await fileCalls(() => lstat(directory));
  return { changedMs: info.ctimeMs, inode: inodeOf(info), modifiedMs: info.mtimeMs };
}

/**
 * The times of the folder `directoryId`, one the catalog read inside `root`, as it is on disk
 * now. It is found by its path without resolving links: looking at its own times reads nothing
 * inside it, and a folder that became a link has different times.
 */
export function readFolderTimes(root: string, directoryId: string): Promise<FolderTimes> {
  return readFolderTimesAt(path.join(root, directoryId));
}

/**
 * Reads the entries directly inside `directoryId` from the disk, with their files' metadata.
 * - `resolve` finds the folder on disk. Entry IDs are relative to the canonical `root`.
 * - Last comes the folder's times from when the read began. The catalog keeps it to tell later
 *   whether the folder changed since; see `FolderTimes`. It is left out if any look at an entry
 *   failed, apart from entries that turned out not to be there.
 */
export async function* readFolder(
  root: string,
  directoryId: string,
  { signal, resolve }: { signal: AbortSignal; resolve: (id: string) => Promise<string> },
): AsyncGenerator<ReadItem, void> {
  const directory = await fileCalls(() => resolve(directoryId));
  const base = path.relative(root, directory);
  // Taken before the folder's contents are read, so a change during the read leaves the folder to
  // the next read.
  const times = await readFolderTimesAt(directory);
  let failed = false;
  const contents = listable(await fileCalls(() => readdir(directory, { withFileTypes: true })));
  for (let start = 0; start < contents.length; start += STAT_BATCH) {
    const chunk = contents.slice(start, start + STAT_BATCH);
    const infos = await Promise.allSettled(
      chunk.map((dirent) => fileCalls(() => stat(path.join(directory, dirent.name)))),
    );
    for (const [offset, dirent] of chunk.entries()) {
      signal.throwIfAborted();
      const entry: PhotoEntry = {
        id: path.join(base, dirent.name),
        kind: entryKindOf(dirent.name, dirent),
        name: dirent.name,
        parentId: directoryId,
      };
      const info = infos[offset];
      if (info?.status === 'fulfilled') {
        entry.metadata = metadataOf(info.value);
      } else if (info) {
        // A name SMB can't look up says nothing is there (see "Names SMB can't look up" above). An
        // entry that really went away changed the folder's times, and the folder times were taken
        // before its contents were read. So only failures that can last leave the folder without
        // folder times.
        failed ||= !isNotFoundOrNotAFolder(info.reason);
        // IDs are paths relative to the root, so they say where an entry that fails is.
        yield {
          error: { entryId: entry.id, message: errorMessage(info.reason), path: entry.id },
          kind: 'error',
        };
      }
      yield { entry, kind: 'entry' };
    }
  }
  if (!failed) {
    yield { kind: 'folder-times', times };
  }
}
