import path from 'node:path';

// Entry IDs are paths relative to the library's folder, which is `.`.

/** `id` as it is once the entry `from`, or a folder holding it, is moved to `to`. */
export function movedId(id: string, from: string, to: string): string {
  if (id === from) {
    return to;
  }
  return id.startsWith(`${from}${path.sep}`) ? to + id.slice(from.length) : id;
}

/** The IDs among `ids` that are `folderId` itself or inside it. */
export function idsWithin(folderId: string, ids: Iterable<string>): string[] {
  const prefix = `${folderId}${path.sep}`;
  return [...ids].filter((id) => id === folderId || id.startsWith(prefix));
}

/** Whether `id` is inside one of `folders`. */
export function isInsideAny(folders: Set<string>, id: string): boolean {
  for (let parent = path.dirname(id); parent !== '.'; parent = path.dirname(parent)) {
    if (folders.has(parent)) {
      return true;
    }
  }
  return false;
}
