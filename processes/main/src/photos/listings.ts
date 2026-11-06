import { errorMessage } from '#photos/errors';
import { listable, mediaKind } from '#photos/media';
import type { PhotoEntry, PhotoExif, ScanBatch, ScanOptions } from '@prism/shared';
import type { Stats } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

// Entries are small, so this keeps a few very large folders, or whole trees of small ones.
const MAX_ENTRIES = 200_000,
  // Metadata is read this many files at a time.
  STAT_BATCH = 64;

export type ScanItem = { entry: PhotoEntry } | { error: ScanBatch['errors'][number] };

/**
 * How much a listing tells of each entry: only its name and kind, its file's metadata too, or
 * photos' EXIF details as well. Each tells everything the ones before it do.
 */
export type Detail = 'names' | 'metadata' | 'exif';
const DETAILS: Detail[] = ['names', 'metadata', 'exif'];

/** What a scan with `options` asks to know of each entry. */
export function detailOf(options: Pick<ScanOptions, 'metadata' | 'exif'>): Detail {
  if (options.exif) {
    return 'exif';
  }
  return options.metadata ? 'metadata' : 'names';
}

/** Whether a listing that tells `known` tells what `wanted` asks for. */
export function tells(known: Detail, wanted: Detail): boolean {
  return DETAILS.indexOf(known) >= DETAILS.indexOf(wanted);
}

/** Reads the EXIF details of the photo `file`, which is as `info` says. */
export type ExifReader = (file: string, info: Stats) => Promise<PhotoExif>;

interface Listing {
  entries: PhotoEntry[];
  detail: Detail;
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
    detail: Detail,
    read: () => AsyncIterable<ScanItem>,
  ): AsyncGenerator<ScanItem, void> {
    const cached = this.get(directoryId, detail);
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
      this.end(reading, detail, complete ? listed : undefined);
    }
  }

  /** The folder's entries, if they were read with as much `detail` as is asked for. */
  get(directoryId: string, detail: Detail): PhotoEntry[] | undefined {
    const listing = this.listings.get(directoryId);
    if (!listing || !tells(listing.detail, detail)) {
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
  end(read: ListingRead, detail: Detail, entries?: PhotoEntry[]): void {
    this.reading.delete(read);
    if (!entries || read.stale || entries.length > MAX_ENTRIES) {
      return;
    }
    this.drop(read.directoryId);
    this.listings.set(read.directoryId, { detail, entries });
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
 * Reads the entries directly inside `directoryId` from the disk, with as much `detail` as asked
 * for, photos' EXIF details coming from `exif`. `resolve` finds the folder on disk. Entry IDs are relative to the canonical `root`,
 * as `resolve` expects.
 */
export async function* readFolder(
  root: string,
  directoryId: string,
  {
    detail,
    signal,
    resolve,
    exif,
  }: {
    detail: Detail;
    signal: AbortSignal;
    resolve: (id: string) => Promise<string>;
    exif?: ExifReader;
  },
): AsyncGenerator<ScanItem, void> {
  const directory = await resolve(directoryId);
  const base = path.relative(root, directory);
  const listing = listable(await readdir(directory, { withFileTypes: true }));
  for (let start = 0; start < listing.length; start += STAT_BATCH) {
    const chunk = listing.slice(start, start + STAT_BATCH);
    const infos =
      detail === 'names'
        ? []
        : await Promise.allSettled(chunk.map((dirent) => stat(path.join(directory, dirent.name))));
    const details =
      detail === 'exif' && exif
        ? await Promise.allSettled(
            chunk.map((dirent, offset) => {
              const info = infos[offset];
              return info?.status === 'fulfilled' &&
                dirent.isFile() &&
                mediaKind(dirent.name) === 'image'
                ? exif(path.join(directory, dirent.name), info.value)
                : undefined;
            }),
          )
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
      const read = details[offset];
      if (read?.status === 'fulfilled' && read.value) {
        entry.exif = read.value;
      } else if (read?.status === 'rejected') {
        yield { error: { entryId: entry.id, message: errorMessage(read.reason) } };
      }
      yield { entry };
    }
  }
}
