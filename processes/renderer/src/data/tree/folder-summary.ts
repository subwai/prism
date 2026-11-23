import type { FolderSummary } from '@prism/shared';

/**
 * Whether a folder's tile may still change once the worker reads the folder. That is so when the
 * catalog has not worked the tile out yet, or has not read the folder to the end, or the folder
 * has no covers of its own but has subfolders that may give it some.
 */
export function mayTileChange(summary?: FolderSummary): boolean {
  return !summary || !summary.read || (summary.covers.length === 0 && summary.hasSubfolders);
}

/**
 * Whether a folder's tile says it holds folders. Until the catalog has read the folder, the tile
 * knows nothing inside it, so this returns `otherwise` instead.
 */
export function holdsFolders(summary: FolderSummary | undefined, otherwise: boolean): boolean {
  return summary?.hasSubfolders || (summary?.read ? false : otherwise);
}
