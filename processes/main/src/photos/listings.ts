import type { PathChange } from '#photos/changes';
import type { StoredListings } from '#photos/listing-store';
import { type Detail, type ScanItem, tells } from '#photos/read-folder';
import type { PhotoEntry } from '@prism/shared';
import path from 'node:path';
import pLimit from 'p-limit';

// Entries are small, so this keeps a few very large folders, or whole trees of small ones.
const MAX_ENTRIES = 200_000,
  // Stored folders read again at once to catch up with the disk, behind what the window asks.
  CATCH_UP_CONCURRENCY = 4;

interface Listing {
  entries: PhotoEntry[];
  detail: Detail;
}

/** Reads a folder from the disk with as much `detail` as asked for, until `signal` aborts. */
export type FolderReader = (detail: Detail, signal: AbortSignal) => AsyncIterable<ScanItem>;

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
 * The entries of `directoryId` that differ between its listings `before` and `after`: those
 * that came, went, changed kind, or whose files were rewritten, as far as the listings tell.
 */
export function differences(
  directoryId: string,
  before: PhotoEntry[],
  after: PhotoEntry[],
): PathChange[] {
  const earlier = new Map(before.map((entry) => [entry.id, entry]));
  const changes: PathChange[] = [];
  for (const entry of after) {
    const was = earlier.get(entry.id);
    earlier.delete(entry.id);
    if (
      was?.kind !== entry.kind ||
      was.metadata?.size !== entry.metadata?.size ||
      was.metadata?.modifiedMs !== entry.metadata?.modifiedMs
    ) {
      changes.push({ id: entry.id, parentId: directoryId });
    }
  }
  for (const id of earlier.keys()) {
    changes.push({ id, parentId: directoryId });
  }
  return changes;
}

/**
 * The entries directly inside each folder as a complete read found them, until the watcher sees
 * the folder change or the window refreshes, so going back to a large folder does not read it
 * from the disk again. A read that was under way when its folder was forgotten saw it as it was,
 * so it is not remembered: it would outlast the change.
 *
 * With a `store`, listings also outlast the session. A stored listing is shown at once, but the
 * folder may have changed while nothing watched it, so it is read again behind the scenes, once
 * a session, and what differs goes to the `onStale` listener as if the watcher had seen it.
 */
export class ListingCache {
  /** Most recently used last. */
  private readonly listings = new Map<string, Listing>();
  private entries = 0;
  private readonly reading = new Set<ListingRead>();
  /** Folders whose stored listing matches the disk, or is being read again to make sure. */
  private readonly current = new Set<string>();
  private readonly catchUps = pLimit(CATCH_UP_CONCURRENCY);
  private stale?: (changes: PathChange[]) => void;

  /** Reads to catch up stop with `signal`. */
  constructor(
    private readonly store?: StoredListings,
    private readonly signal = new AbortController().signal,
  ) {}

  /** Tells `listener` what stored listings missed, such as changes made while the app was closed. */
  onStale(listener: (changes: PathChange[]) => void): void {
    this.stale = listener;
  }

  /** Whether `recall` would find the folder's entries, without reading them. */
  knows(directoryId: string, detail: Detail): boolean {
    const listing = this.listings.get(directoryId);
    if (listing && tells(listing.detail, detail)) {
      return true;
    }
    const stored = this.store?.detailOf(directoryId);
    return stored !== undefined && tells(stored, detail);
  }

  /**
   * The folder's entries as last read, if they tell `detail` and it has not changed since: from
   * memory, or else from the store. A stored listing is read again behind the scenes, once a
   * session; whoever shows it calls `shown` once every entry was shown, so what differs is told.
   * One that stopped early closed its view, and the folder is current again for the next.
   */
  recall(
    directoryId: string,
    detail: Detail,
    read: FolderReader,
  ): { entries: PhotoEntry[]; shown: () => void } | undefined {
    const cached = this.get(directoryId, detail);
    if (cached) {
      return { entries: cached, shown: () => null };
    }
    const stored = this.store?.get(directoryId);
    if (!stored || !tells(stored.detail, detail)) {
      return undefined;
    }
    const caughtUp = this.current.has(directoryId)
      ? undefined
      : this.catchUp(directoryId, stored, read);
    // Without a listener, a failed catch-up is only a folder read again next time.
    caughtUp?.catch(() => null);
    return {
      entries: stored.entries,
      shown: () => {
        caughtUp
          ?.then((changes) => {
            if (changes.length > 0) {
              this.stale?.(changes);
            }
          })
          .catch(() => null);
      },
    };
  }

  /**
   * The folder's entries as `recall` finds them, or else as `read` finds them until `signal`
   * aborts, remembered once it has read them all without errors.
   */
  async *list(
    directoryId: string,
    detail: Detail,
    signal: AbortSignal,
    read: FolderReader,
  ): AsyncGenerator<ScanItem, void> {
    const recalled = this.recall(directoryId, detail, read);
    if (recalled) {
      for (const entry of recalled.entries) {
        yield { entry };
      }
      recalled.shown();
      return;
    }
    const reading = this.start(directoryId);
    const listed: PhotoEntry[] = [];
    // A scan closed before the end leaves it incomplete, as an entry that could not be read does.
    let complete = false,
      failed = false;
    try {
      for await (const item of read(detail, signal)) {
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

  /** Reads a stored folder again, with as much detail as was stored, and says what differs. */
  private catchUp(directoryId: string, stored: Listing, read: FolderReader) {
    this.current.add(directoryId);
    return this.catchUps(async () => {
      const reading = this.start(directoryId);
      const listed: PhotoEntry[] = [];
      let complete = false,
        failed = false;
      try {
        for await (const item of read(stored.detail, this.signal)) {
          if ('entry' in item) {
            listed.push(item.entry);
          } else {
            failed = true;
          }
        }
        complete = !failed;
      } catch (error) {
        // A later listing tries again; a folder that went is the change its own folder sees.
        this.current.delete(directoryId);
        throw error;
      } finally {
        this.end(reading, stored.detail, complete ? listed : undefined);
      }
      // Entries that could not be read are told of too: whoever is told looks at each again.
      return differences(directoryId, stored.entries, listed);
    });
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
    this.store?.set(read.directoryId, { detail, entries });
    this.current.add(read.directoryId);
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
    for (const directoryId of this.current) {
      if (matches(directoryId)) {
        this.current.delete(directoryId);
      }
    }
  }

  /** Drops the listings of `directoryIds`, which changed, or of every folder, stored or not. */
  forget(directoryIds?: Iterable<string>): void {
    if (!directoryIds) {
      this.forgetWhere(() => true);
      this.store?.forgetInside('.');
      return;
    }
    const ids = new Set(directoryIds);
    this.forgetWhere((directoryId) => ids.has(directoryId));
    this.store?.forget(ids);
  }

  /** Drops the listings of `folderId` and of every folder inside it, which went with it. */
  forgetInside(folderId: string): void {
    this.forgetWhere((directoryId) => isInside(directoryId, folderId));
    this.store?.forgetInside(folderId);
  }

  /** Lets go of what is remembered in memory, keeping what is stored for the next session. */
  close(): void {
    this.forgetWhere(() => true);
  }
}
