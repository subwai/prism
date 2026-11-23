import { isNameTaken } from '#photos/worker/disk/fs-errors';
import { NAME_TOO_LONG, refusalMessages } from '#photos/worker/disk/refusal-messages';
import { lstat, rename } from 'node:fs/promises';
import path from 'node:path';

// `lstat` reads what the disk records of a file: its size, its times and its number on the disk,
// for a link the link itself rather than what it points to.
// `ino`, the inode, is a file's number on its disk, which a rename keeps; `dev` is the number
// of the disk itself.

const FAILURE_MESSAGES: Partial<Record<string, string>> = {
  ...refusalMessages('rename'),
  ENAMETOOLONG: NAME_TOO_LONG,
};

function nameTakenError(name: string) {
  return new Error(`The name “${name}” is already taken. Choose a different name.`);
}

/** Renames `source` within its folder, never replacing another file or folder. */
export async function renameInFolder(source: string, name: string): Promise<void> {
  const target = path.join(path.dirname(source), name);
  if (target === source) {
    return;
  }
  const [before, existing] = await Promise.all([lstat(source), lstat(target).catch(() => null)]);
  // On a case-insensitive disk, a new capitalization finds the entry itself, which is fine.
  if (existing && (existing.ino !== before.ino || existing.dev !== before.dev)) {
    throw nameTakenError(name);
  }
  try {
    await rename(source, target);
  } catch (error) {
    if (isNameTaken(error)) {
      throw nameTakenError(name);
    }
    const code = (error as NodeJS.ErrnoException).code ?? '';
    throw new Error(
      FAILURE_MESSAGES[code] ?? `It could not be renamed (${code || 'unknown error'}).`,
      {
        cause: error,
      },
    );
  }
}
