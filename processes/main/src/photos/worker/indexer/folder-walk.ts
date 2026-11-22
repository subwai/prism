import type { FolderRead } from '#photos/worker/indexer/index-run';
import type { CurrentPriority } from '#photos/worker/scheduler/scheduler';
import type { Scope } from '@prism/catalog';
import path from 'node:path';

// Folders a walk hands the scheduler at a time, which reads them as the folder limits allow.
const READ_AHEAD = 16;

/** How deep `id` is inside the library, whose own folder is `.`. */
export function depthOf(id: string): number {
  return id === '.' ? 0 : id.split(path.sep).length;
}

/**
 * How a walk found a folder:
 * - `own`: the scope's own folder, which is on screen.
 * - `known`: one the catalog knew inside the scope. It is found again on disk with its links
 *   resolved, because it may have changed.
 * - `listed`: one a read in this walk listed inside a folder already resolved. It is new to the
 *   catalog, as every folder is on an empty catalog, so it has no stamp.
 */
type FoundAs = 'own' | 'known' | 'listed';

export interface FolderWalk {
  scope: Scope;
  /** The folders the catalog knows inside the scope, if it is recursive. */
  knownFolders: string[];
  /** Reads a folder at `priority`; `found` says how the walk found it. */
  read: (folder: string, found: FoundAs, priority: CurrentPriority) => Promise<FolderRead>;
  onRead: (folder: string, read: FolderRead) => void;
  /** Called with how many folders the walk has looked at, of how many it has found so far. */
  onProgress?: (looked: number, found: number) => void;
  signal: AbortSignal;
}

/**
 * Reads the folders of a scope breadth first, until done or `signal` aborts: its own folder,
 * then the ones the catalog knew inside it, shallowest first, then the ones the reads find.
 */
export async function walkFolders({
  scope,
  knownFolders,
  read,
  onRead,
  onProgress,
  signal,
}: FolderWalk) {
  const folders = [scope.directoryId];
  // Folders the catalog knew are found again on disk, because they may have changed. Folders
  // found in this walk were listed inside a folder already resolved.
  const known = new Set<string>(folders);
  for (const id of knownFolders.toSorted((left, right) => depthOf(left) - depthOf(right))) {
    folders.push(id);
    known.add(id);
  }
  const listed = new Set(folders);
  let looked = 0;
  onProgress?.(looked, folders.length);
  const handleRead = (folder: string, done: FolderRead) => {
    onRead(folder, done);
    for (const subfolder of scope.recursive ? done.subfolders : []) {
      if (!listed.has(subfolder)) {
        listed.add(subfolder);
        folders.push(subfolder);
      }
    }
    looked += 1;
    onProgress?.(looked, folders.length);
  };
  // The scope's own folder goes first, because it is on screen, and alone: if it cannot be read,
  // as when the share is offline, nothing inside it can be either.
  const own = await read(scope.directoryId, 'own', () => (signal.aborted ? null : 'visible'));
  handleRead(scope.directoryId, own);
  if (own.error !== null) {
    return;
  }
  // The rest are a re-check in the background. They are handed to the scheduler, which orders
  // reads across walks, a few at a time instead of all at once: a library can hold a hundred
  // thousand folders, which would take a hundred megabytes to queue, and a walk that stops must
  // leave the rest unread.
  const background = () => (signal.aborted ? null : 'background');
  const active = new Set<Promise<void>>();
  let next = 1;
  while (next < folders.length || active.size > 0) {
    while (next < folders.length && active.size < READ_AHEAD && !signal.aborted) {
      const folder = folders[next] as string;
      next += 1;
      const task = read(folder, known.has(folder) ? 'known' : 'listed', background)
        .then((done) => handleRead(folder, done))
        .finally(() => active.delete(task));
      active.add(task);
    }
    if (active.size === 0) {
      break;
    }
    await Promise.race(active);
  }
  signal.throwIfAborted();
}
