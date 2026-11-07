import type { ScanState } from '#data/directory-scan';
import { arrangeEntries } from '#data/entries';
import type { PhotoEntry } from '@prism/shared';

const subfolderLists = new WeakMap<ScanState, PhotoEntry[]>();
/** The folders a scan found, by name, kept per scan so each state sorts them once. */
export function subfolders(state: ScanState | undefined) {
  if (!state) {
    return [];
  }
  let list = subfolderLists.get(state);
  if (!list) {
    const directories = state.entries.filter((entry) => entry.kind === 'directory');
    list = arrangeEntries(directories, '', 'name', false);
    subfolderLists.set(state, list);
  }
  return list;
}
