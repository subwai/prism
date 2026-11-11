import { perFolderFile } from '#photos/main/per-folder-file';
import { isString } from '#photos/validate';

const file = perFolderFile('current-folders.json', isString);

/** The folder inside `root` the window last showed, by ID, if it remembers one. */
export async function currentFolder(root: string): Promise<string | null> {
  return (await file.read(root)) ?? null;
}

/** Remembers the folder inside `root` the window shows, to show it again the next time `root` opens. */
export function rememberCurrentFolder(root: string, folderId: string): Promise<void> {
  return file.write(root, folderId);
}
