/**
 * The folders the sidebar's tree opened or closed by hand, by ID, which it opens again as it
 * left them the next time the same folder opens.
 */
export type OpenedFolders = [id: string, open: boolean][];

/**
 * The folders of a library as the catalog knows them, for the sidebar's tree, which shows them
 * without asking the disk: each as `[id, parentId, name]`, siblings by name, and which folders
 * were read to the end, whose subfolders are all it lists. Read for the whole library, or for the
 * subfolders of some folders, of which `listed` then names those read.
 */
export interface FolderSkeleton {
  folders: [id: string, parentId: string, name: string][];
  listed: string[];
}
