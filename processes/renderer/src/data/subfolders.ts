import { byName } from '#data/entries';
import type { FolderListing, PhotoEntry } from '@prism/shared';

const subfolderLists = new WeakMap<FolderListing, PhotoEntry[]>();
/** The folders a listing holds, by name, kept per listing so each sorts them once. */
export function subfolders(state: FolderListing | undefined) {
  if (!state) {
    return [];
  }
  let list = subfolderLists.get(state);
  if (!list) {
    const directories = state.entries.filter((entry) => entry.kind === 'directory');
    list = byName(directories);
    subfolderLists.set(state, list);
  }
  return list;
}
