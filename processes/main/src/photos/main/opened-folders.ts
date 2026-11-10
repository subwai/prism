import { requireOpenedFolders } from '#photos/validate';
import type { OpenedFolders } from '@prism/shared';
import { app } from 'electron';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** How many folders' trees are kept, the most recently used; older ones open as new. */
const MAX_ROOTS = 32;

function openedFoldersFile() {
  return path.join(app.getPath('userData'), 'opened-folders.json');
}

/** Each folder's tree, by the folder's path, the most recently remembered last. */
async function readAll(): Promise<Record<string, unknown>> {
  try {
    const saved: unknown = JSON.parse(await readFile(openedFoldersFile(), 'utf8'));
    return saved && typeof saved === 'object' && !Array.isArray(saved)
      ? (saved as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

// Writes go one at a time, so a later one is never overwritten by one that started before it.
let writing = Promise.resolve();

/** The folders the tree had opened or closed when `root` was last open; losing them only closes them. */
export async function openedFolders(root: string): Promise<OpenedFolders> {
  await writing;
  const folders = (await readAll())[root];
  try {
    requireOpenedFolders(folders);
    return folders;
  } catch {
    return [];
  }
}

/** Remembers the tree's opened and closed folders for the next time `root` opens. */
export function rememberOpenedFolders(root: string, folders: OpenedFolders): Promise<void> {
  writing = writing.then(async () => {
    const { [root]: _previous, ...others } = await readAll();
    const kept = Object.entries(others).slice(1 - MAX_ROOTS);
    const all = Object.fromEntries([...kept, [root, folders]]);
    await writeFile(openedFoldersFile(), JSON.stringify(all)).catch(() => null);
  });
  return writing;
}
