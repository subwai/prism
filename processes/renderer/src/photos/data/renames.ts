import type { PhotoEntry } from '@prism/shared';

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

/** Entries renamed in this window, so views holding their old IDs can find them again. */
export class Renames {
  /** Old IDs to new ones. */
  private readonly moves = new Map<string, string>();

  /** Records a rename, and moves `folders` inside a renamed folder to their new IDs. */
  record(from: string, to: string, folders: Map<string, PhotoEntry>) {
    // The old name is in use again, so it no longer leads anywhere.
    this.moves.delete(to);
    this.moves.set(from, to);
    // The renamed folder itself is listed anew, under its new name, by the change.
    const inside = [...folders.values()].filter(
      (folder) => folder.id !== from && rebase(folder.id, from, to) !== folder.id
    );
    for (const folder of inside) {
      const id = rebase(folder.id, from, to);
      folders.delete(folder.id);
      folders.set(id, { ...folder, id, parentId: rebase(folder.parentId, from, to) });
    }
  }

  /** Where `id` is now, following each rename that moved it. */
  follow(id: string) {
    let current = id;
    let moved = true;
    for (let step = 0; moved && step < this.moves.size; step += 1) {
      moved = false;
      for (const [from, to] of this.moves) {
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
}
