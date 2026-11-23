// What the window says when the system refuses to change an entry, rather than the raw error
// and its paths.

/** The entry is gone from the disk. */
export const ENTRY_GONE = 'It no longer exists.';

/** A new name has more bytes than the disk allows. */
export const NAME_TOO_LONG = 'That name is too long.';

/**
 * The words for each error code the system refuses with. `verb` is what was refused, as in
 * "You don’t have permission to rename it."
 */
export function refusalMessages(verb: 'change' | 'rename'): Partial<Record<string, string>> {
  const noPermission = `You don’t have permission to ${verb} it.`;
  return {
    EACCES: noPermission,
    EBUSY: 'It is in use. Close it in other apps and try again.',
    ENOENT: ENTRY_GONE,
    EPERM: noPermission,
    EROFS: 'It is on a disk that can’t be changed.',
  };
}
