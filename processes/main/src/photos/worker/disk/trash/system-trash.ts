import { restoreItem, trashItem } from '@prism/trash';

/** Moves `file` to the system's Trash, and resolves with where it landed there. */
export function moveToSystemTrash(file: string): Promise<string> {
  return trashItem(file);
}

/** Moves what the system's Trash holds at `landed` back to `to`, which must be free. */
export function putBackFromSystemTrash(landed: string, to: string): Promise<void> {
  return restoreItem(landed, to);
}
