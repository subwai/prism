import { isNotFound } from '#photos/worker/disk/fs-errors';
import { lstat, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';

/** Rejects if nothing is at `file`. A link counts as itself, not as what it points at. */
export async function requireEntryAt(file: string): Promise<void> {
  await lstat(file);
}

/** The device, or volume, that `file` is on. A link counts as itself. */
export async function deviceOf(file: string): Promise<number> {
  return (await lstat(file)).dev;
}

/** Whether nothing is at `file`. */
export async function isPathFree(file: string): Promise<boolean> {
  try {
    await lstat(file);
    return false;
  } catch (error) {
    if (isNotFound(error)) {
      return true;
    }
    throw error;
  }
}

/** Makes the folders that `file` goes in, if they are not there yet. */
export async function makeParentFolders(file: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
}

/** Moves the entry at `from` to `to`, on the same volume. */
export function moveOnDisk(from: string, to: string): Promise<void> {
  return rename(from, to);
}
