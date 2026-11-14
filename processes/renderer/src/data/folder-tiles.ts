import type { FolderSummary } from '@prism/shared';

/**
 * Whether a folder's tile may not say all it will once the worker reads the folder: the catalog
 * has not worked it out, or not read the folder to the end, or the folder has no covers of its
 * own but folders inside that may lend some.
 */
export function unsettled(summary?: FolderSummary): boolean {
  return !summary || !summary.read || (summary.covers.length === 0 && summary.hasSubfolders);
}

/**
 * Whether a folder's tile says it holds folders: `undefined` until the catalog has read the
 * folder, as one it has not read holds nothing it knows of, which says nothing of its folders.
 */
export function holdsFolders(summary?: FolderSummary): boolean | undefined {
  return summary?.hasSubfolders || (summary?.read ? false : undefined);
}
