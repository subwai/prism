import type { FolderRead } from '#photos/worker/folder-reads';
import type { Want } from '#photos/worker/scheduler';
import type { Scope } from '@prism/catalog';
import path from 'node:path';

// Folders a walk hands the scheduler at a time, which reads them as the folder lane allows.
const READ_AHEAD = 16;

/** How deep `id` is inside the library, whose own folder is `.`. */
export function depthOf(id: string): number {
  return id === '.' ? 0 : id.split(path.sep).length;
}

export interface FolderWalk {
  scope: Scope;
  /** The folders the catalog knows inside the scope, if it is recursive. */
  inside: string[];
  /** Reads a folder, finding it on disk with its links resolved if `resolving`, as `wants` says. */
  read: (folder: string, resolving: boolean, wants: Want) => Promise<FolderRead>;
  onRead: (folder: string, read: FolderRead) => void;
  signal: AbortSignal;
}

/**
 * Reads the folders of a scope breadth first: its own, then those the catalog knew inside it,
 * shallowest first, and those the reads find, until done or `signal` aborts.
 */
export async function walkFolders({ scope, inside, read, onRead, signal }: FolderWalk) {
  const folders = [scope.directoryId];
  // Folders the catalog knew are found again on disk, possibly not as they were; those found
  // in this walk were listed inside a folder already resolved.
  const known = new Set<string>(folders);
  for (const id of inside.toSorted((left, right) => depthOf(left) - depthOf(right))) {
    folders.push(id);
    known.add(id);
  }
  const listed = new Set(folders);
  const found = (folder: string, done: FolderRead) => {
    onRead(folder, done);
    for (const subfolder of scope.recursive ? done.subfolders : []) {
      if (!listed.has(subfolder)) {
        listed.add(subfolder);
        folders.push(subfolder);
      }
    }
  };
  // The scope's own folder first, as it is on show, and alone: nothing inside a folder that
  // cannot be read can be, as when the share is offline.
  const own = await read(scope.directoryId, true, () => (signal.aborted ? null : 'visible'));
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
      const task = read(folder, known.has(folder), background)
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
