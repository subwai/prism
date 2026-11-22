import { isMissing } from '#photos/worker/fs-errors';
import type { FolderStamp } from '@prism/catalog';
import { INDEX_CONCURRENCY, inodeOf, listable, mediaKind } from '@prism/media';
import { errorMessage, type PhotoEntry, type PhotoMetadata, type ReadError } from '@prism/shared';
import type { Stats } from 'node:fs';
import { lstat, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import pLimit from 'p-limit';

// Metadata is read this many files at a time.
const STAT_BATCH = 64;

/**
 * Limits the file calls of every folder being read to the threads kept for them. The rest wait
 * here instead of in libuv's queue, where they would get ahead of the calls that find
 * thumbnails; see `INDEX_CONCURRENCY`.
 */
const fileCalls = pLimit(INDEX_CONCURRENCY);

/** What `readFolder` yields: an entry, an entry that could not be read, or, last, the folder's stamp. */
export type ReadItem = { entry: PhotoEntry } | { error: ReadError } | { stamp: FolderStamp };

/** What an entry named `name` is, as a listing or `stat` describes it. */
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

/** The stamp of the folder at `directory` as it is on disk now; see `FolderStamp`. A link has its own. */
async function readStampAt(directory: string): Promise<FolderStamp> {
  const info = await fileCalls(() => lstat(directory));
  return { changedMs: info.ctimeMs, inode: inodeOf(info), modifiedMs: info.mtimeMs };
}

/**
 * The stamp of the folder `directoryId`, one the catalog read inside `root`, as it is on disk
 * now. It is found by its path without resolving links: looking at its own times reads nothing
 * inside it, and a folder that became a link has a different stamp.
 */
export function readFolderStamp(root: string, directoryId: string): Promise<FolderStamp> {
  return readStampAt(path.join(root, directoryId));
}

/**
 * Reads the entries directly inside `directoryId` from the disk, with their files' metadata.
 * - `resolve` finds the folder on disk. Entry IDs are relative to the canonical `root`.
 * - Last comes the folder's stamp from when the read began. The catalog keeps it to tell later
 *   whether the folder changed since; see `FolderStamp`. It is left out if any look at an entry
 *   failed, apart from entries that turned out not to be there.
 */
export async function* readFolder(
  root: string,
  directoryId: string,
  { signal, resolve }: { signal: AbortSignal; resolve: (id: string) => Promise<string> },
): AsyncGenerator<ReadItem, void> {
  const directory = await fileCalls(() => resolve(directoryId));
  const base = path.relative(root, directory);
  // Taken before the listing, so a change during the read leaves the folder to the next read.
  const stamp = await readStampAt(directory);
  let failed = false;
  const listing = listable(await fileCalls(() => readdir(directory, { withFileTypes: true })));
  for (let start = 0; start < listing.length; start += STAT_BATCH) {
    const chunk = listing.slice(start, start + STAT_BATCH);
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
        // Over SMB, names that end in a dot or a space are listed, but looking at them says
        // nothing is there. An entry that really went away changed the folder's times, and the
        // stamp was taken before the listing. So only failures that can last leave the folder
        // without a stamp.
        failed ||= !isMissing(info.reason);
        // IDs are paths relative to the root, so they say where an entry that fails is.
        yield { error: { entryId: entry.id, message: errorMessage(info.reason), path: entry.id } };
      }
      yield { entry };
    }
  }
  if (!failed) {
    yield { stamp };
  }
}
