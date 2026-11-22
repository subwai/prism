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
 * How a walk came by a folder: the scope's `own`, which is on show; one the catalog `known` inside
 * it, found again on disk with its links resolved, as it may not be as it was; or one `listed`
 * by a read in this walk inside a folder already resolved, which is new to the catalog, as every
 * folder is on an empty one, so it has no stamp.
 */
type FoundAs = 'own' | 'known' | 'listed';

export interface FolderWalk {
  scope: Scope;
  /** The folders the catalog knows inside the scope, if it is recursive. */
  inside: string[];
  /** Reads a folder the walk came by as `found` says, as `priority` says. */
  read: (folder: string, found: FoundAs, priority: CurrentPriority) => Promise<FolderRead>;
  onRead: (folder: string, read: FolderRead) => void;
  /** Hears how many folders the walk has looked at, of how many it has found so far. */
  onProgress?: (looked: number, found: number) => void;
  signal: AbortSignal;
}

/**
 * Reads the folders of a scope breadth first: its own, then those the catalog knew inside it,
 * shallowest first, and those the reads find, until done or `signal` aborts.
 */
export async function walkFolders({ scope, inside, read, onRead, onProgress, signal }: FolderWalk) {
  const folders = [scope.directoryId];
  // Folders the catalog knew are found again on disk, possibly not as they were; those found
  // in this walk were listed inside a folder already resolved.
  const known = new Set<string>(folders);
  for (const id of inside.toSorted((left, right) => depthOf(left) - depthOf(right))) {
    folders.push(id);
    known.add(id);
  }
  const listed = new Set(folders);
  let looked = 0;
  onProgress?.(looked, folders.length);
  const found = (folder: string, done: FolderRead) => {
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
  // The scope's own folder first, as it is on show, and alone: nothing inside a folder that
  // cannot be read can be, as when the share is offline.
  const own = await read(scope.directoryId, 'own', () => (signal.aborted ? null : 'visible'));
  found(scope.directoryId, own);
  if (own.error !== null) {
    return;
  }
  // The rest are a re-check in the background. They start a few at a time, rather than all
  // handed to the scheduler, which orders reads across walks: a library can hold a hundred
  // thousand folders, which queued would take a hundred megabytes, and a walk that stops must
  // leave the rest unread.
  const background = () => (signal.aborted ? null : 'background');
  const active = new Set<Promise<void>>();
  let next = 1;
  while (next < folders.length || active.size > 0) {
    while (next < folders.length && active.size < READ_AHEAD && !signal.aborted) {
      const folder = folders[next] as string;
      next += 1;
      const task = read(folder, known.has(folder) ? 'known' : 'listed', background)
        .then((done) => found(folder, done))
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
