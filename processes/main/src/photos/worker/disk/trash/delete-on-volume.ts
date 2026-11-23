import { lstat, readdir, rmdir, unlink } from 'node:fs/promises';
import path from 'node:path';

/**
 * Deletes `file` for good, and what is inside it, never crossing onto another volume than
 * `dev`, such as a share mounted inside it, whose files may have a Trash of their own.
 */
export async function deleteOnVolume(file: string, dev: number): Promise<void> {
  const info = await lstat(file);
  if (info.dev !== dev) {
    throw new Error(`“${path.basename(file)}” is on another disk.`);
  }
  if (!info.isDirectory()) {
    await unlink(file);
    return;
  }
  for (const name of await readdir(file)) {
    await deleteOnVolume(path.join(file, name), dev);
  }
  await rmdir(file);
}
