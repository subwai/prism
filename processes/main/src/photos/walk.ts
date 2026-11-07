import type { ChangeTracker } from '#photos/changes';
import { errorMessage } from '#photos/errors';
import type { ExifDetails } from '#photos/exif';
import type { FolderReader, ListingCache } from '#photos/listings';
import { emptySummary, updateSummary } from '#photos/media';
import { readInOrder } from '#photos/read-ahead';
import { type Detail, detailOf, readFolder, type ScanItem } from '#photos/read-folder';
import type { SummaryCache } from '#photos/summaries';
import type { FolderSummary, PhotoEntry, ScanOptions } from '@prism/shared';
import path from 'node:path';

// Only a folder linked inside itself goes this deep; symbolic links are skipped already.
const MAX_DEPTH = 1024,
  // Folders read at once during a walk. A network share answers many at once about as fast as
  // one, while a local disk gains little past a few.
  READ_AHEAD = 16;

// Marks the end of a folder's entries.
const READ = Symbol('read');

interface Folder {
  depth: number;
  id: string;
}

/** `items`, then `READ`. */
async function* endingWithRead<Item>(items: AsyncIterable<Item>) {
  yield* items;
  yield READ;
}

/** What a walk reads folders with, and notes what it finds in. */
export interface WalkSources {
  /** The canonical path of the folder opened. */
  root: string;
  /** Finds an entry on disk, checking it is inside `root`. */
  resolve: (entryId: string) => Promise<string>;
  listings: ListingCache;
  summaries: SummaryCache;
  tracker: ChangeTracker;
  exif: ExifDetails;
}

/** Walks a library's folders, as its scans and folder inspections do. */
export class Walker {
  constructor(private readonly sources: WalkSources) {}

  /**
   * Lists `options.directoryId`, and with `recursive` every folder inside it, breadth first:
   * the shallowest photos arrive first however deep the tree goes. Up to `READ_AHEAD` folders
   * are read at once, as a network share answers each read only after a round trip, but their
   * entries still arrive in order. It stops after opening `maxFolders` folders, and leaves out
   * what is inside `excludeDirectoryIds`.
   *
   * A recursive scan lists the folders whose listings it knows already as soon as the folder
   * holding them is done, rather than in their turn, so they never wait behind the folders it
   * reads from the disk: going up to a folder holding one read before shows its contents at once.
   * Inspections keep to the order, as they look for the shallowest covers.
   */
  async *walk(
    options: ScanOptions,
    signal: AbortSignal,
    maxFolders = Infinity,
  ): AsyncGenerator<ScanItem, void> {
    const detail = detailOf(options);
    const excluded = new Set(options.excludeDirectoryIds);
    const outOfTurn = options.recursive === true && maxFolders === Infinity;
    // Folders to read from the disk, joined by those found along the way.
    const folders: Folder[] = [];
    // Known folders found since the last were listed.
    let known: Folder[] = [];
    const found = (folder: Folder) => {
      if (
        outOfTurn &&
        folder.depth <= MAX_DEPTH &&
        this.sources.listings.knows(folder.id, detail)
      ) {
        known.push(folder);
      } else {
        folders.push(folder);
      }
    };
    const inside = (entry: PhotoEntry) =>
      options.recursive === true && entry.kind === 'directory' && !excluded.has(entry.id);
    const recall = (folder: Folder) => this.recall(folder, detail);
    // Listing known folders finds more, which are listed in turn. One forgotten since it was
    // found, as a change on disk does, is read in its turn instead.
    async function* listKnown() {
      while (known.length > 0) {
        const listing = known;
        known = [];
        for (const folder of listing) {
          signal.throwIfAborted();
          const recalled = recall(folder);
          if (!recalled) {
            folders.push(folder);
            continue;
          }
          for (const entry of recalled.entries) {
            yield { entry };
            if (inside(entry)) {
              found({ depth: folder.depth + 1, id: entry.id });
            }
          }
          recalled.shown();
        }
      }
    }

    found({ depth: 0, id: options.directoryId });
    yield* listKnown();
    for await (const [parent, item] of readInOrder(
      folders,
      (folder, reading) => endingWithRead(this.read(folder, detail, reading)),
      { ahead: READ_AHEAD, limit: maxFolders, signal },
    )) {
      if (item === READ) {
        yield* listKnown();
      } else {
        yield item;
        if ('entry' in item && inside(item.entry)) {
          found({ depth: parent.depth + 1, id: item.entry.id });
        }
      }
    }
  }

  /** The listing of `folder` if it is known already, noted as a read from the disk is. */
  private recall(folder: Folder, detail: Detail) {
    const { listings, summaries, tracker } = this.sources;
    const since = summaries.since(folder.id);
    const recalled = listings.recall(folder.id, detail, this.reader(folder));
    if (recalled) {
      const summary = emptySummary();
      for (const entry of recalled.entries) {
        updateSummary(summary, entry);
        tracker.listed(entry);
      }
      this.rememberSummary(folder.id, summary, since);
    }
    return recalled;
  }

  /** A folder's entries as `walk` lists them, ending with an error if it cannot be read. */
  private async *read(folder: Folder, detail: Detail, signal: AbortSignal) {
    try {
      if (folder.depth > MAX_DEPTH) {
        throw new Error('Directory nesting exceeds the scan depth limit.');
      }
      yield* this.list(folder.id, detail, signal, this.reader(folder));
    } catch (error) {
      signal.throwIfAborted();
      // IDs are paths relative to the root, so they say where a folder that fails is.
      yield { error: { entryId: folder.id, message: errorMessage(error), path: folder.id } };
    }
  }

  /** Reads `folder` from the disk. */
  private reader(folder: Folder): FolderReader {
    const { exif, resolve, root } = this.sources;
    // A folder the walk found was listed inside one already resolved, and symbolic links are
    // skipped, so it is canonical as it is, sparing a round trip to resolve it again.
    const locate =
      folder.depth === 0 ? resolve : (id: string) => Promise.resolve(path.join(root, id));
    return (wanted, reading) =>
      readFolder(root, folder.id, {
        detail: wanted,
        exif: (file, info) => exif.of(file, info, reading),
        resolve: locate,
        signal: reading,
      });
  }

  /** The entries directly inside a folder, with as much `detail` as asked for. */
  private async *list(
    directoryId: string,
    detail: Detail,
    signal: AbortSignal,
    read: FolderReader,
  ): AsyncGenerator<ScanItem, void> {
    const { listings, summaries, tracker } = this.sources;
    const since = summaries.since(directoryId);
    const summary = emptySummary();
    for await (const item of listings.list(directoryId, detail, signal, read)) {
      signal.throwIfAborted();
      if ('entry' in item) {
        updateSummary(summary, item.entry);
        tracker.listed(item.entry);
      }
      yield item;
    }
    this.rememberSummary(directoryId, summary, since);
  }

  private rememberSummary(directoryId: string, summary: FolderSummary, since: string) {
    // A folder without covers of its own looks inside its subfolders when it is inspected.
    if (summary.covers.length > 0 || !summary.hasSubfolders) {
      this.sources.summaries.remember(directoryId, summary, since);
    }
  }
}
