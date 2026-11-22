import type { ReadItem } from '#photos/worker/indexer/read-folder';
import type { CatalogWrite, FolderStamp, KnownItem } from '@prism/catalog';
import type { PhotoEntry, ReadError } from '@prism/shared';
import path from 'node:path';

// How many entries a read hands the catalog at once, so a large folder shows up bit by bit while
// it is read.
const WRITE_CHUNK = 256;

/**
 * Whether a listed entry differs from what the catalog knows of it.
 * - The inode counts, so a catalog from before inodes were kept learns each one as its folder
 *   is read.
 * - An entry that was listed but could not be looked at says nothing new about one the catalog
 *   knows, so the catalog keeps its size and times, and with them its details. That happens over
 *   SMB to names that end in a dot or a space, and when the volume goes away partway through a
 *   read.
 */
export function hasChanged(known: KnownItem | undefined, entry: PhotoEntry) {
  if (!entry.metadata && known?.kind === entry.kind) {
    return false;
  }
  return (
    known?.kind !== entry.kind ||
    known.size !== (entry.metadata?.size ?? null) ||
    known.modifiedMs !== (entry.metadata?.modifiedMs ?? null) ||
    known.inode !== (entry.metadata?.inode ?? null)
  );
}

/**
 * Hands `write` the entries of a folder's read, `items`, that differ from what the catalog has of
 * them in `known`, a chunk at a time.
 * - Each listed entry is taken out of `known`, so what is left there is gone from the folder.
 * - What could not be read goes into `found.errors`, and the folders listed into
 *   `found.subfolders`.
 * - Returns the folder's stamp, if the read ended with one.
 */
export async function writeChangedEntries(
  items: AsyncIterable<ReadItem>,
  known: Map<string, KnownItem>,
  found: { errors: ReadError[]; subfolders: string[] },
  write: (listed: PhotoEntry[]) => void,
): Promise<FolderStamp | null> {
  let changed: PhotoEntry[] = [];
  let stamp: FolderStamp | null = null;
  try {
    for await (const item of items) {
      switch (item.kind) {
        case 'stamp': {
          ({ stamp } = item);
          break;
        }
        case 'error': {
          found.errors.push(item.error);
          break;
        }
        default: {
          const { entry } = item;
          if (entry.kind === 'directory') {
            found.subfolders.push(entry.id);
          }
          if (hasChanged(known.get(entry.id), entry)) {
            changed.push(entry);
          }
          if (changed.length >= WRITE_CHUNK) {
            write(changed);
            changed = [];
          }
          known.delete(entry.id);
          break;
        }
      }
    }
  } finally {
    // What was read before a failure still holds.
    if (changed.length > 0) {
      write(changed);
    }
  }
  return stamp;
}

/** The folders whose rows `writes` would have changed. They must be read again if the writes failed. */
export function foldersWrittenBy(writes: CatalogWrite[]): string[] {
  return writes.flatMap((write) => {
    switch (write.kind) {
      case 'list': {
        return write.entries.map((entry) => entry.parentId);
      }
      case 'remove': {
        return write.ids.map((id) => path.dirname(id));
      }
      case 'markIndexed': {
        return [write.folderId];
      }
      default: {
        return [];
      }
    }
  });
}
