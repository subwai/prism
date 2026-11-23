import { NAME_TOO_LONG, refusalMessages } from '#photos/worker/disk/refusal-messages';
import { lstat, rename } from 'node:fs/promises';
import path from 'node:path';

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
    const code = (error as NodeJS.ErrnoException).code ?? '';
    if (code === 'EEXIST' || code === 'ENOTEMPTY') {
      throw nameTakenError(name);
    }
    throw new Error(
      FAILURE_MESSAGES[code] ?? `It could not be renamed (${code || 'unknown error'}).`,
      {
        cause: error,
      },
    );
  }
}
