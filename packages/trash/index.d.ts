/**
 * Moves the file or folder at `path` to the system's Trash: the Trash of its volume on macOS,
 * the Recycle Bin on Windows, and the freedesktop.org Trash on Linux. Resolves with where it
 * landed there, which `restoreItem` takes, as the Trash renames an item whose name it holds.
 * Rejects with the system's words if it can't, as on a volume with no Trash, rather than
 * deleting it for good.
 */
export function trashItem(path: string): Promise<string>;

/**
 * Moves what `trashItem` put at `landed` back to `to`, which must be free, and drops what the
 * Trash kept of it, such as the Recycle Bin's `$I…` record or the freedesktop `.trashinfo`.
 */
export function restoreItem(landed: string, to: string): Promise<void>;
