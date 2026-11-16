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
 * Bounds the file calls of every folder being read to the threads kept for them, so the rest
 * wait here rather than in libuv's queue, ahead of the calls that find thumbnails; see
 * `INDEX_CONCURRENCY`.
 */
const files = pLimit(INDEX_CONCURRENCY);

/** An entry, what could not be read of one, or last, the folder's stamp; see `readFolder`. */
export type ReadItem = { entry: PhotoEntry } | { error: ReadError } | { stamp: FolderStamp };

/** What an entry named `name` is, as a listing or `stat` describes it. */
export function kindOf(
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

/** How the folder at `directory` is on disk now; see `FolderStamp`. A link has its own. */
async function stampAt(directory: string): Promise<FolderStamp> {
  const info = await files(() => lstat(directory));
  return { changedMs: info.ctimeMs, inode: inodeOf(info), modifiedMs: info.mtimeMs };
}

/**
 * How the folder `directoryId`, one the catalog read inside `root`, is on disk now. It is found
 * by its path, with nothing resolved, as a look at its own times reads nothing inside it, and
 * one that became a link differs.
 */
export function stampOf(root: string, directoryId: string): Promise<FolderStamp> {
  return stampAt(path.join(root, directoryId));
}

/**
 * Reads the entries directly inside `directoryId` from the disk, with their files' metadata.
 * `resolve` finds the folder on disk; entry IDs are relative to the canonical `root`, as it
 * expects. Last comes the folder's stamp as the read began, if nothing failed, which then
 * stands for all it read; see `FolderStamp`.
 */
export async function* readFolder(
  root: string,
  directoryId: string,
  { signal, resolve }: { signal: AbortSignal; resolve: (id: string) => Promise<string> },
): AsyncGenerator<ReadItem, void> {
  const directory = await files(() => resolve(directoryId));
  const base = path.relative(root, directory);
  // Before the listing, so a change while it is read leaves the folder to the next read.
  const stamp = await stampAt(directory);
  let failed = false;
  const listing = listable(await files(() => readdir(directory, { withFileTypes: true })));
  for (let start = 0; start < listing.length; start += STAT_BATCH) {
    const chunk = listing.slice(start, start + STAT_BATCH);
    const infos = await Promise.allSettled(
      chunk.map((dirent) => files(() => stat(path.join(directory, dirent.name)))),
    );
    for (const [offset, dirent] of chunk.entries()) {
      signal.throwIfAborted();
      const entry: PhotoEntry = {
        id: path.join(base, dirent.name),
        kind: kindOf(dirent.name, dirent),
        name: dirent.name,
        parentId: directoryId,
      };
      const info = infos[offset];
      if (info?.status === 'fulfilled') {
        entry.metadata = metadataOf(info.value);
      } else if (info) {
        failed = true;
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
