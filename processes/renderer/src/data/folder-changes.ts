import { isWithin } from '#data/trails';
import type { FolderChange, PhotoEntry } from '@prism/shared';
import type { Query } from '@tanstack/react-query';

/** The folders `changed` were in, those whose listings they changed, and the entries gone. */
export function touchedBy(changed: FolderChange[]) {
  return {
    parents: new Set(changed.map(({ parentId }) => parentId)),
    relisted: new Set(
      changed.filter((change) => change.listingChanged).map(({ parentId }) => parentId),
    ),
    removed: new Set(changed.filter(({ entry }) => entry === null).map(({ id }) => id)),
  };
}

/** The known folders, by ID, as `changed` left them. */
export function foldersAfter(folders: ReadonlyMap<string, PhotoEntry>, changed: FolderChange[]) {
  const after = new Map(folders);
  for (const { id, entry } of changed) {
    if (entry?.kind === 'directory') {
      after.set(id, entry);
    } else if (entry === null) {
      after.delete(id);
    }
  }
  return after;
}

/**
 * Which listings to read again once the folders `relisted` list something different. A listing
 * shows its folders' tiles, whose covers can come from deep inside, so it is those of the
 * folders holding each, up to the root at `rootId`, and no others.
 */
export function listingsChangedBy(rootId: string, relisted: ReadonlySet<string>) {
  return ({ queryKey: [kind, folderId] }: Query) =>
    kind === 'directory' &&
    [...relisted].some((parentId) => isWithin(rootId, String(folderId), parentId));
}
