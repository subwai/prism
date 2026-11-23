import { requireString } from '#photos/validate';
import { ENTRY_GONE, NAME_TOO_LONG } from '#photos/worker/disk/refusal-messages';
import { renameInFolder } from '#photos/worker/disk/rename-in-folder';
import type { PhotoLibrary } from '#photos/worker/library/library';
import { isIgnored } from '@prism/media';
import type { FolderChange, PhotoEntry } from '@prism/shared';
import path from 'node:path';

const MAX_NAME_BYTES = 255;

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
    throw new Error(NAME_TOO_LONG);
  }
}

/**
 * Renames an entry of `library` within its folder. The changes it returns, which the window
 * applies at once, are remembered as seen, so the watcher's report of them changes nothing.
 */
export async function renameEntry(
  library: PhotoLibrary,
  entryId: string,
  name: string,
): Promise<{ entry: PhotoEntry; changes: FolderChange[] }> {
  requireString(entryId);
  requireName(name);
  if (path.normalize(entryId) === '.') {
    throw new Error('The open folder can’t be renamed here.');
  }
  const parentId = path.dirname(entryId);
  const id = path.join(parentId, name);
  const source = await library.resolve(entryId);
  if (id === entryId) {
    const entry = await library.entryAt(id, parentId);
    if (!entry) {
      throw new Error(ENTRY_GONE);
    }
    return { changes: [], entry };
  }
  // Its rows and kept ratings move with it, so nothing inside it is read again.
  const moved = await library.move(entryId, id, async () => {
    await renameInFolder(source, name);
    return library.entryAt(id, parentId);
  });
  if (!moved) {
    throw new Error(ENTRY_GONE);
  }
  return moved;
}
