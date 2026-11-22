import { idsWithin, isInsideAny, movedId } from '#photos/worker/entry-ids';
import type { FolderChange } from '@prism/shared';
import type { Stats } from 'node:fs';

/**
 * The files whose original or thumbnail the window was shown, by their content signature at
 * that moment. A change to such a file is judged against this signature, not the catalog's.
 * The catalog can learn of a rewrite first, when a folder is read again, but the window still
 * shows the old contents. For the same reason, reading a file again after it changed, before
 * the watcher reports it, keeps the signature from the first read.
 */
export type ShownFiles = Map<string, string>;

/** Size and modification time: enough to tell rewritten contents apart. */
export function contentSignature(size: number, modifiedMs: number): string {
  return `${size}:${modifiedMs}`;
}

/** Notes that the window was shown the contents of `entryId`, as `info` describes the file. */
export function noteShown(
  shown: ShownFiles,
  entryId: string,
  info: Pick<Stats, 'mtimeMs' | 'size'>,
): void {
  if (!shown.has(entryId)) {
    shown.set(entryId, contentSignature(info.size, info.mtimeMs));
  }
}

/**
 * Notes that `entryId` was rewritten without changing what it shows, as writing its rating
 * does. The watcher's report of the rewrite then reads nothing again.
 */
export function noteRewritten(shown: ShownFiles, entryId: string, info: Stats): void {
  if (shown.has(entryId)) {
    shown.set(entryId, contentSignature(info.size, info.mtimeMs));
  }
}

/** Moves the shown files at `from`, and everything inside it, to `to`, as the app moved it. */
export function moveShownFiles(shown: ShownFiles, from: string, to: string): void {
  for (const id of idsWithin(from, shown.keys())) {
    const signature = shown.get(id) ?? '';
    shown.delete(id);
    shown.set(movedId(id, from, to), signature);
  }
}

/**
 * Updates the shown files after `described` changes. A changed file stays shown with its new
 * signature: the window reads it again, and a file written in place can change again before
 * that read arrives. Removed files are forgotten, with everything inside removed folders.
 */
export function updateShownFiles(shown: ShownFiles, described: FolderChange[]): void {
  const removed = new Set(described.filter(({ entry }) => !entry).map(({ id }) => id));
  for (const { id, entry } of described) {
    if (entry?.metadata && shown.has(id)) {
      shown.set(id, contentSignature(entry.metadata.size, entry.metadata.modifiedMs));
    } else {
      shown.delete(id);
    }
  }
  if (removed.size > 0) {
    for (const id of shown.keys()) {
      if (isInsideAny(removed, id)) {
        shown.delete(id);
      }
    }
  }
}
