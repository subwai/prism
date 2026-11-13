import type { CatalogWrite, KnownItem } from '@prism/catalog';
import type { PhotoEntry } from '@prism/shared';
import path from 'node:path';

/**
 * Whether a listing of an entry says something other than what the catalog knows of it. Its
 * inode counts, so a catalog from before it kept them learns each as its folder is read.
 */
export function differs(known: KnownItem | undefined, entry: PhotoEntry) {
  return (
    known?.kind !== entry.kind ||
    known.size !== (entry.metadata?.size ?? null) ||
    known.modifiedMs !== (entry.metadata?.modifiedMs ?? null) ||
    known.inode !== (entry.metadata?.inode ?? null)
  );
}

/** The folders whose rows `writes` would have changed, which must be read again if they failed. */
export function foldersOf(writes: CatalogWrite[]): string[] {
  return writes.flatMap((write) => {
    if ('listed' in write) {
      return write.listed.map((entry) => entry.parentId);
    }
    if ('removed' in write) {
      return write.removed.map((id) => path.dirname(id));
    }
    return 'indexed' in write ? [write.indexed] : [];
  });
}
