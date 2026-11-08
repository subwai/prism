import type { FolderChange, PhotoEntry } from '@prism/shared';

/**
 * `removed` and everything `entries` list inside them. A listing that starts from another's
 * entries can name a folder after its contents, so this goes by parents rather than by order.
 */
function removedWith(entries: PhotoEntry[], removed: string[]) {
  const gone = new Set<string>();
  if (removed.length === 0) {
    return gone;
  }
  const children = new Map<string, string[]>();
  for (const { id, parentId } of entries) {
    const siblings = children.get(parentId);
    if (siblings) {
      siblings.push(id);
    } else {
      children.set(parentId, [id]);
    }
  }
  const stack = [...removed];
  for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
    if (!gone.has(id)) {
      gone.add(id);
      // A folder can hold more entries than a call takes arguments, so not spread.
      for (const child of children.get(id) ?? []) {
        stack.push(child);
      }
    }
  }
  return gone;
}

/**
 * `entries` with `changes` applied: changed entries replaced, removed ones dropped along with
 * everything inside removed folders, and new ones added wherever the listing `shows` their
 * folder. `null` if the listing is unchanged.
 */
export function patchEntries(
  entries: PhotoEntry[],
  changes: FolderChange[],
  shows: (parentId: string) => boolean,
): PhotoEntry[] | null {
  const pending = new Map(changes.map((change) => [change.id, change]));
  const gone = removedWith(
    entries,
    changes.filter((change) => change.entry === null).map((change) => change.id),
  );
  const patched: PhotoEntry[] = [];
  let touched = false;
  for (const entry of entries) {
    const change = pending.get(entry.id);
    pending.delete(entry.id);
    if (gone.has(entry.id)) {
      touched = true;
    } else if (change?.entry) {
      patched.push(change.entry);
      touched = true;
    } else {
      patched.push(entry);
    }
  }
  for (const { entry, parentId } of pending.values()) {
    if (entry && !gone.has(parentId) && shows(parentId)) {
      patched.push(entry);
      touched = true;
    }
  }
  return touched ? patched : null;
}
