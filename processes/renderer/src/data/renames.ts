import type { PhotoEntry } from '@prism/shared';

/** Entries renamed in this window, old IDs to new ones, so views holding old IDs find them. */
export type Renames = ReadonlyMap<string, string>;

/** `id` with the entry `from`, or a folder holding it, moved to `to`. */
function rebase(id: string, from: string, to: string) {
  if (id === from) {
    return to;
  }
  // IDs are paths, separated however the system separates them.
  const separator = id[from.length];
  return id.startsWith(from) && (separator === '/' || separator === '\\')
    ? to + id.slice(from.length)
    : id;
}

/** `renames` with `from` renamed to `to`. */
export function withRename(renames: Renames, from: string, to: string): Renames {
  const next = new Map(renames);
  // The old name is in use again, so it no longer leads anywhere.
  next.delete(to);
  next.set(from, to);
  return next;
}

/** Where `id` is now, following each rename that moved it. */
export function follow(renames: Renames, id: string): string {
  let current = id;
  let moved = true;
  for (let step = 0; moved && step < renames.size; step += 1) {
    moved = false;
    for (const [from, to] of renames) {
      const next = rebase(current, from, to);
      if (next !== current) {
        current = next;
        moved = true;
        break;
      }
    }
  }
  return current;
}

/**
 * `folders` with those inside `from` moved to their IDs inside `to`. The renamed folder itself
 * is listed anew, under its new name, by the change.
 */
export function withFoldersMoved(
  folders: ReadonlyMap<string, PhotoEntry>,
  from: string,
  to: string,
): Map<string, PhotoEntry> {
  const next = new Map(folders);
  for (const folder of folders.values()) {
    const id = rebase(folder.id, from, to);
    if (folder.id !== from && id !== folder.id) {
      next.delete(folder.id);
      next.set(id, { ...folder, id, parentId: rebase(folder.parentId, from, to) });
    }
  }
  return next;
}
