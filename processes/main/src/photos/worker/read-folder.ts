import { errorMessage } from '#photos/errors';
import { listable, mediaKind } from '@prism/media';
import type { PhotoEntry, ReadError } from '@prism/shared';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

// Metadata is read this many files at a time.
const STAT_BATCH = 64;

export type ReadItem = { entry: PhotoEntry } | { error: ReadError };

/**
 * Reads the entries directly inside `directoryId` from the disk, with their files' metadata.
 * `resolve` finds the folder on disk; entry IDs are relative to the canonical `root`, as it
 * expects.
 */
export async function* readFolder(
  root: string,
  directoryId: string,
  { signal, resolve }: { signal: AbortSignal; resolve: (id: string) => Promise<string> },
): AsyncGenerator<ReadItem, void> {
  const directory = await resolve(directoryId);
  const base = path.relative(root, directory);
  const listing = listable(await readdir(directory, { withFileTypes: true }));
  for (let start = 0; start < listing.length; start += STAT_BATCH) {
    const chunk = listing.slice(start, start + STAT_BATCH);
    const infos = await Promise.allSettled(
      chunk.map((dirent) => stat(path.join(directory, dirent.name))),
    );
    for (const [offset, dirent] of chunk.entries()) {
      signal.throwIfAborted();
      const entry: PhotoEntry = {
        id: path.join(base, dirent.name),
        kind: dirent.isDirectory()
          ? 'directory'
          : (dirent.isFile() && mediaKind(dirent.name)) || 'file',
        name: dirent.name,
        parentId: directoryId,
      };
      const info = infos[offset];
      if (info?.status === 'fulfilled') {
        entry.metadata = {
          accessedMs: info.value.atimeMs,
          createdMs: info.value.birthtimeMs,
          modifiedMs: info.value.mtimeMs,
          size: info.value.size,
        };
      } else if (info) {
        // IDs are paths relative to the root, so they say where an entry that fails is.
        yield { error: { entryId: entry.id, message: errorMessage(info.reason), path: entry.id } };
      }
      yield { entry };
    }
  }
}
