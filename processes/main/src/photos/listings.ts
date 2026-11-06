import { errorMessage } from '#photos/errors';
import { listable, mediaKind } from '#photos/media';
import type { PhotoEntry, ScanBatch } from '@prism/shared';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

// Entries are small, so this keeps a few very large folders, or whole trees of small ones.
const MAX_ENTRIES = 200_000,
  // Metadata is read this many files at a time.
  STAT_BATCH = 64;

export type ScanItem = { entry: PhotoEntry } | { error: ScanBatch['errors'][number] };

interface Listing {
  entries: PhotoEntry[];
  metadata: boolean;
}

/** A read of a folder under way, which goes stale if the folder is forgotten meanwhile. */
export interface ListingRead {
  readonly directoryId: string;
  stale: boolean;
}

/** Whether `id` is `folderId` or inside it. */
function isInside(id: string, folderId: string) {
  return id === folderId || folderId === '.' || id.startsWith(`${folderId}${path.sep}`);
}

/**
 * The entries directly inside each folder as a complete read found them, until the watcher sees
 * the folder change or the window refreshes, so going back to a large folder does not read it
 * from the disk again. A read that was under way when its folder was forgotten saw it as it was,
 * so it is not remembered: it would outlast the change.
 */
export class ListingCache {
  /** Most recently used last. */
  private readonly listings = new Map<string, Listing>();
  private entries = 0;
  private readonly reading = new Set<ListingRead>();

  /**
   * The folder's entries as last read, unless it changed since, or else as `read` finds them,
   * remembered once it has read them all without errors.
   */
  async *list(
    directoryId: string,
    metadata: boolean,
    read: () => AsyncIterable<ScanItem>,
  ): AsyncGenerator<ScanItem, void> {
    const cached = this.get(directoryId, metadata);
    if (cached) {
      for (const entry of cached) {
        yield { entry };
      }
      return;
    }
    const reading = this.start(directoryId);
    const listed: PhotoEntry[] = [];
    // A scan closed before the end leaves it incomplete, as an entry that could not be read does.
    let complete = false,
      failed = false;
    try {
      for await (const item of read()) {
        if ('entry' in item) {
          listed.push(item.entry);
        } else {
          failed = true;
        }
        yield item;
      }
      complete = !failed;
    } finally {
      this.end(reading, metadata, complete ? listed : undefined);
    }
  }

  /** The folder's entries, if they were read with `metadata` when it is asked for. */
  get(directoryId: string, metadata: boolean): PhotoEntry[] | undefined {
    const listing = this.listings.get(directoryId);
    if (!listing || (metadata && !listing.metadata)) {
      return undefined;
    }
    this.listings.delete(directoryId);
    this.listings.set(directoryId, listing);
    return listing.entries;
  }

  /** Starts a read of `directoryId`, which `end` finishes, remembering it if it is complete. */
  start(directoryId: string): ListingRead {
    const read = { directoryId, stale: false };
    this.reading.add(read);
    return read;
  }

  /** `entries` is the complete listing, or `undefined` if the read stopped or failed. */
  end(read: ListingRead, metadata: boolean, entries?: PhotoEntry[]): void {
    this.reading.delete(read);
    if (!entries || read.stale || entries.length > MAX_ENTRIES) {
      return;
    }
    this.drop(read.directoryId);
    this.listings.set(read.directoryId, { entries, metadata });
    this.entries += entries.length;
    for (const oldest of this.listings.keys()) {
      if (this.entries <= MAX_ENTRIES) {
        break;
      }
      this.drop(oldest);
    }
  }

  private drop(directoryId: string) {
    this.entries -= this.listings.get(directoryId)?.entries.length ?? 0;
    this.listings.delete(directoryId);
  }

  private forgetWhere(matches: (directoryId: string) => boolean) {
    for (const directoryId of this.listings.keys()) {
      if (matches(directoryId)) {
        this.drop(directoryId);
      }
    }
    for (const read of this.reading) {
      if (matches(read.directoryId)) {
        read.stale = true;
      }
    }
  }

  /** Drops the listings of `directoryIds`, or of every folder. */
  forget(directoryIds?: Iterable<string>): void {
    if (!directoryIds) {
      this.forgetWhere(() => true);
      return;
    }
    const ids = new Set(directoryIds);
    this.forgetWhere((directoryId) => ids.has(directoryId));
  }

  /** Drops the listings of `folderId` and of every folder inside it, which went with it. */
  forgetInside(folderId: string): void {
    this.forgetWhere((directoryId) => isInside(directoryId, folderId));
  }
}

/**
 * Reads the entries directly inside `directoryId` from the disk, with their `metadata` if asked
 * for. Entry IDs are relative to the canonical `root`, as `resolve` expects.
 */
export async function* readFolder(
  root: string,
  directoryId: string,
  metadata: boolean,
  signal: AbortSignal,
  resolve: (id: string) => Promise<string>,
): AsyncGenerator<ScanItem, void> {
  const directory = await resolve(directoryId);
  const base = path.relative(root, directory);
  const listing = listable(await readdir(directory, { withFileTypes: true }));
  for (let start = 0; start < listing.length; start += STAT_BATCH) {
    const chunk = listing.slice(start, start + STAT_BATCH);
    const infos = metadata
      ? await Promise.allSettled(chunk.map((dirent) => stat(path.join(directory, dirent.name))))
      : [];
    for (const [offset, dirent] of chunk.entries()) {
      signal.throwIfAborted();
      const entry: PhotoEntry = {
        id: path.join(base, dirent.name),
        kind: dirent.isDirectory()
          ? 'directory'
          : (dirent.isFile() && mediaKind(dirent.name)) || 'file',
        name: dirent.name,
        parentId: directoryId,
      };
      const info = infos[offset];
      if (info?.status === 'fulfilled') {
        entry.metadata = {
          accessedMs: info.value.atimeMs,
          createdMs: info.value.birthtimeMs,
          modifiedMs: info.value.mtimeMs,
          size: info.value.size,
        };
      } else if (info) {
        yield { error: { entryId: entry.id, message: errorMessage(info.reason) } };
      }
      yield { entry };
    }
  }
}
