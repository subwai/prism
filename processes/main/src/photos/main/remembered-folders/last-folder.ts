import { app } from 'electron';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

function lastFolderFile() {
  return path.join(app.getPath('userData'), 'last-folder.json');
}

/** Remembers the folder the user picked, to reopen next launch; losing it only costs a dialog. */
export async function rememberFolder(root: string): Promise<void> {
  await writeFile(lastFolderFile(), JSON.stringify({ root })).catch(() => null);
}

/**
 * The folder the user picked in an earlier session, by its canonical path, without looking for
 * it on the disk, which may be a share that is slow or offline.
 */
export async function lastFolder(): Promise<string | null> {
  try {
    const { root } = JSON.parse(await readFile(lastFolderFile(), 'utf8')) as { root?: unknown };
    return typeof root === 'string' ? root : null;
  } catch {
    return null;
  }
}
