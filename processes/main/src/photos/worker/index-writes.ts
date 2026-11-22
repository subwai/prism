import type { ReadItem } from '#photos/worker/read-folder';
import type { CatalogWrite, FolderStamp, KnownItem } from '@prism/catalog';
import type { PhotoEntry, ReadError } from '@prism/shared';
import path from 'node:path';

// Entries a read hands the catalog at a time, so a large folder shows as it is read.
const WRITE_CHUNK = 256;

/**
 * Whether a listing of an entry says something other than what the catalog knows of it. Its
 * inode counts, so a catalog from before it kept them learns each as its folder is read. An
 * entry listed but not looked at, as over SMB a name that ends in a dot or a space is, or as
 * the volume goes partway through a read, says nothing new of one the catalog knows, so it
 * keeps its size and times, and with them its details.
 */
export function differs(known: KnownItem | undefined, entry: PhotoEntry) {
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
 * Hands `write` the entries of a folder's read, `items`, that differ from what the catalog has
 * of them in `known`, a chunk at a time, and takes each entry listed out of `known`, so what is
 * left there is gone from the folder. What could not be read goes into `found.errors`, and the
 * folders listed into `found.subfolders`. Returns the folder's stamp, if the read ended with one.
 */
export async function writeDiffering(
  items: AsyncIterable<ReadItem>,
  known: Map<string, KnownItem>,
  found: { errors: ReadError[]; subfolders: string[] },
  write: (listed: PhotoEntry[]) => void,
): Promise<FolderStamp | null> {
  let changed: PhotoEntry[] = [];
  let stamp: FolderStamp | null = null;
  try {
    for await (const item of items) {
      if ('stamp' in item) {
        ({ stamp } = item);
      } else if ('error' in item) {
        found.errors.push(item.error);
      } else {
        const { entry } = item;
        if (entry.kind === 'directory') {
          found.subfolders.push(entry.id);
        }
        if (differs(known.get(entry.id), entry)) {
          changed.push(entry);
        }
        if (changed.length >= WRITE_CHUNK) {
          write(changed);
          changed = [];
        }
        known.delete(entry.id);
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

/** The folders whose rows `writes` would have changed, which must be read again if they failed. */
export function foldersOf(writes: CatalogWrite[]): string[] {
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
