import { type PhotoLibrary, requireString } from '#photos/library';
import { isIgnored } from '#photos/media';
import type { FolderChange, PhotoEntry } from '@prism/shared';
import { lstat, rename } from 'node:fs/promises';
import path from 'node:path';

const MAX_NAME_BYTES = 255,
  NO_PERMISSION = 'You don’t have permission to rename it.',
  GONE = 'It no longer exists.';

// What the window says when the system refuses a rename, rather than the raw error and its paths.
const FAILURES: Partial<Record<string, string>> = {
  EACCES: NO_PERMISSION,
  EBUSY: 'It is in use. Close it in other apps and try again.',
  ENAMETOOLONG: 'That name is too long.',
  ENOENT: GONE,
  EPERM: NO_PERMISSION,
  EROFS: 'It is on a disk that can’t be changed.'
};

function taken(name: string) {
  return new Error(`The name “${name}” is already taken. Choose a different name.`);
}

/** Checks a new name for an entry: one path segment the listings would show. */
function requireName(name: unknown): asserts name is string {
  if (typeof name !== 'string' || name.trim() === '') {
    throw new Error('Enter a name.');
  }
  if (
    name === '.' ||
    name === '..' ||
    name.includes('/') ||
    name.includes(path.sep) ||
    name.includes('\0') ||
    isIgnored(name)
  ) {
    throw new Error(`“${name}” can’t be used as a name.`);
  }
  if (Buffer.byteLength(name) > MAX_NAME_BYTES) {
    throw new Error('That name is too long.');
  }
}

/** Renames `source` within its folder, never replacing another file or folder. */
async function renameFile(source: string, name: string) {
  const target = path.join(path.dirname(source), name);
  if (target === source) {
    return;
  }
  const [before, existing] = await Promise.all([lstat(source), lstat(target).catch(() => null)]);
  // On a case-insensitive disk, a new capitalization finds the entry itself, which is fine.
  if (existing && (existing.ino !== before.ino || existing.dev !== before.dev)) {
    throw taken(name);
  }
  try {
    await rename(source, target);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? '';
    if (code === 'EEXIST' || code === 'ENOTEMPTY') {
      throw taken(name);
    }
    throw new Error(FAILURES[code] ?? `It could not be renamed (${code || 'unknown error'}).`, {
      cause: error
    });
  }
}

/**
 * Renames an entry of `library` within its folder. The changes it returns, which the window
 * applies at once, are remembered as seen, so the watcher's report of them changes nothing.
 */
export async function renameEntry(
  library: PhotoLibrary,
  entryId: string,
  name: string
): Promise<{ entry: PhotoEntry; changes: FolderChange[] }> {
  requireString(entryId);
  requireName(name);
  if (path.normalize(entryId) === '.') {
    throw new Error('The open folder can’t be renamed here.');
  }
  const parentId = path.dirname(entryId),
    id = path.join(parentId, name);
  await renameFile(await library.resolve(entryId), name);
  const entry = await library.entryAt(id, parentId);
  if (!entry) {
    throw new Error(GONE);
  }
  if (id === entryId) {
    return { changes: [], entry };
  }
  await library.describeChanges([
    { id: entryId, parentId },
    { id, parentId }
  ]);
  return {
    changes: [
      { contentChanged: false, entry: null, id: entryId, listingChanged: true, parentId },
      { contentChanged: false, entry, id, listingChanged: true, parentId }
    ],
    entry
  };
}
