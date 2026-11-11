import { perFolderFile } from '#photos/main/per-folder-file';
import { isOpenedFolders } from '#photos/validate';
import type { OpenedFolders } from '@prism/shared';

const file = perFolderFile('opened-folders.json', isOpenedFolders);

/** The folders the tree had opened or closed when `root` was last open; losing them only closes them. */
export async function openedFolders(root: string): Promise<OpenedFolders> {
  return (await file.read(root)) ?? [];
}

/** Remembers the tree's opened and closed folders for the next time `root` opens. */
export function rememberOpenedFolders(root: string, folders: OpenedFolders): Promise<void> {
  return file.write(root, folders);
}
