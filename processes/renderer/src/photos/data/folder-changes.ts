import type { FolderChange, PhotoEntry, ScanOptions } from '@prism/shared';

const MAX_DEPTH = 128;

/**
 * Whether a gallery scanned with `options` lists the contents of `directoryId`. `folders`
 * holds the folders read so far, by ID, under the library's `rootId`.
 */
export function lists(
  options: ScanOptions | undefined,
  directoryId: string,
  folders: Map<string, PhotoEntry>,
  rootId: string
) {
  if (!options?.recursive || directoryId === options.directoryId) {
    return directoryId === options?.directoryId;
  }
  let current = directoryId;
  for (let depth = 0; depth < MAX_DEPTH && current !== rootId; depth += 1) {
    const folder = folders.get(current);
    // A folder the gallery has not listed is new, so it is inside if its parent is.
    if (!folder || folder.parentId === options.directoryId) {
      return true;
    }
    current = folder.parentId;
  }
  return options.directoryId === rootId;
}

/**
 * `entries` with `changes` applied: changed entries replaced, removed ones dropped along with
 * everything inside removed folders, and new ones added wherever the listing `shows` their
 * folder. `null` if the listing is unchanged.
 */
export function patchEntries(
  entries: PhotoEntry[],
  changes: FolderChange[],
  shows: (parentId: string) => boolean
): PhotoEntry[] | null {
  const pending = new Map(changes.map((change) => [change.id, change]));
  // Folders that are gone, so whatever was listed inside them is too. Listings name a
  // folder before its contents, so one pass finds them all.
  const gone = new Set<string>();
  const patched: PhotoEntry[] = [];
  let touched = false;
  for (const entry of entries) {
    const change = pending.get(entry.id);
    pending.delete(entry.id);
    if (gone.has(entry.parentId) || change?.entry === null) {
      gone.add(entry.id);
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
