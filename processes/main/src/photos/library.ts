import { ChangeTracker, type PathChange } from '#photos/changes';
import { errorMessage } from '#photos/errors';
import { ListingCache, readFolder, type ScanItem } from '#photos/listings';
import { emptySummary, mediaKind, summarize, updateSummary } from '#photos/media';
import { readInOrder } from '#photos/read-ahead';
import { SummaryCache } from '#photos/summaries';
import type { ThumbnailSource } from '#photos/thumbnails';
import { requireString } from '#photos/validate';
import type {
  FolderChange,
  FolderSummary,
  PhotoEntry,
  ScanBatch,
  ScanOptions,
} from '@prism/shared';
import { randomUUID } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';

const BATCH_SIZE = 128,
  // Only a folder linked inside itself goes this deep; symbolic links are skipped already.
  MAX_DEPTH = 1024,
  MAX_SCANS = 4,
  // Folders read at once during a walk. A network share answers many at once about as fast as
  // one, while a local disk gains little past a few.
  READ_AHEAD = 16;
interface Scan {
  controller: AbortController;
  iterator: AsyncGenerator<ScanItem, void>;
  busy: boolean;
}

function isWithin(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return (
    relative === '' ||
    (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
  );
}

export class PhotoLibrary {
  readonly controller = new AbortController();
  private readonly scans = new Map<string, Scan>();
  private readonly summaries = new SummaryCache();
  private readonly listings = new ListingCache();
  private readonly tracker: ChangeTracker;
  private constructor(readonly root: string) {
    this.tracker = new ChangeTracker(root);
  }

  static async open(root: string): Promise<PhotoLibrary> {
    requireString(root);
    const canonical = await realpath(root);
    const info = await stat(canonical);
    if (!info.isDirectory()) {
      throw new Error('Select a directory.');
    }
    return new PhotoLibrary(canonical);
  }

  async resolve(entryId: string): Promise<string> {
    this.controller.signal.throwIfAborted();
    requireString(entryId);
    const candidate = path.resolve(this.root, entryId);
    if (path.isAbsolute(entryId) || !isWithin(this.root, candidate)) {
      throw new Error('Entry is outside the selected folder.');
    }
    const canonical = await realpath(candidate);
    if (!isWithin(this.root, canonical)) {
      throw new Error('Entry resolves outside the selected folder.');
    }
    this.controller.signal.throwIfAborted();
    return canonical;
  }

  /** A photo or video as it is now, which the watcher then reports any change to. */
  async open(entryId: string): Promise<ThumbnailSource> {
    const file = await this.resolve(entryId);
    const info = await stat(file);
    if (!mediaKind(file) || !info.isFile()) {
      throw new Error('Entry is not a supported photo or video.');
    }
    this.tracker.opened(entryId, info);
    return { file, info };
  }

  async original(entryId: string): Promise<string> {
    return (await this.open(entryId)).file;
  }

  startScan(options: ScanOptions): string {
    this.controller.signal.throwIfAborted();
    if (!options || typeof options !== 'object') {
      throw new Error('Invalid scan options.');
    }
    requireString(options.directoryId);
    if (
      ('recursive' in options && typeof options.recursive !== 'boolean') ||
      ('metadata' in options && typeof options.metadata !== 'boolean')
    ) {
      throw new Error('Invalid scan options.');
    }
    if (this.scans.size >= MAX_SCANS) {
      throw new Error('Too many open scans. Cancel an existing scan first.');
    }
    const scanId = randomUUID(),
      controller = new AbortController();
    this.scans.set(scanId, {
      busy: false,
      controller,
      iterator: this.walk(options, AbortSignal.any([controller.signal, this.controller.signal])),
    });
    return scanId;
  }

  async nextBatch(scanId: string): Promise<ScanBatch> {
    requireString(scanId);
    const scan = this.scans.get(scanId);
    if (!scan) {
      throw new Error('Scan is closed or does not exist.');
    }
    if (scan.busy) {
      throw new Error('Only one batch may be requested at a time for a scan.');
    }
    scan.busy = true;
    const batch: ScanBatch = { done: false, entries: [], errors: [] };
    try {
      while (batch.entries.length + batch.errors.length < BATCH_SIZE) {
        const item = await scan.iterator.next();
        if (item.done) {
          batch.done = true;
          this.scans.delete(scanId);
          break;
        }
        if ('entry' in item.value) {
          batch.entries.push(item.value.entry);
        } else {
          batch.errors.push(item.value.error);
        }
      }
      return batch;
    } catch (error) {
      await this.cancelScan(scanId);
      throw error;
    } finally {
      scan.busy = false;
    }
  }

  async cancelScan(scanId: string): Promise<void> {
    requireString(scanId);
    const scan = this.scans.get(scanId);
    if (scan) {
      scan.controller.abort();
      this.scans.delete(scanId);
      await scan.iterator.return();
    }
  }

  inspectFolder(directoryId: string): Promise<FolderSummary> {
    requireString(directoryId);
    this.controller.signal.throwIfAborted();
    const cached = this.summaries.get(directoryId);
    return cached ? Promise.resolve(cached) : this.readSummary(directoryId);
  }

  private async readSummary(directoryId: string): Promise<FolderSummary> {
    const since = this.summaries.since(directoryId);
    const summary = await summarize(directoryId, (recursive, maxFolders) =>
      this.walk({ directoryId, recursive }, this.controller.signal, maxFolders),
    );
    this.summaries.remember(directoryId, summary, since);
    return summary;
  }

  /**
   * Lists `options.directoryId`, and with `recursive` every folder inside it, breadth first:
   * the shallowest photos arrive first however deep the tree goes. Up to `READ_AHEAD` folders
   * are read at once, as a network share answers each read only after a round trip, but their
   * entries still arrive in order. It stops after opening `maxFolders` folders.
   */
  private async *walk(
    options: ScanOptions,
    signal: AbortSignal,
    maxFolders = Infinity,
  ): AsyncGenerator<ScanItem, void> {
    const folders = [{ depth: 0, id: options.directoryId }];
    const read = (folder: (typeof folders)[number], reading: AbortSignal) =>
      this.read(folder, options.metadata ?? false, reading);
    // Folders found along the way join the end of the list being read.
    for await (const [folder, item] of readInOrder(folders, read, {
      ahead: READ_AHEAD,
      limit: maxFolders,
      signal,
    })) {
      yield item;
      if (options.recursive && 'entry' in item && item.entry.kind === 'directory') {
        folders.push({ depth: folder.depth + 1, id: item.entry.id });
      }
    }
  }

  /** A folder's entries as `walk` lists them, ending with an error if it cannot be read. */
  private async *read(
    folder: { depth: number; id: string },
    metadata: boolean,
    signal: AbortSignal,
  ): AsyncGenerator<ScanItem, void> {
    try {
      if (folder.depth > MAX_DEPTH) {
        throw new Error('Directory nesting exceeds the scan depth limit.');
      }
      // A folder the walk found was listed inside one already resolved, and symbolic links are
      // skipped, so it is canonical as it is, sparing a round trip to resolve it again.
      const locate =
        folder.depth === 0
          ? (id: string) => this.resolve(id)
          : (id: string) => Promise.resolve(path.join(this.root, id));
      yield* this.list(folder.id, metadata, signal, locate);
    } catch (error) {
      signal.throwIfAborted();
      yield { error: { entryId: folder.id, message: errorMessage(error) } };
    }
  }

  /** The entries directly inside a folder, with their `metadata` if asked for. */
  private async *list(
    directoryId: string,
    metadata: boolean,
    signal: AbortSignal,
    locate: (id: string) => Promise<string>,
  ): AsyncGenerator<ScanItem, void> {
    const since = this.summaries.since(directoryId);
    const summary = emptySummary();
    const items = this.listings.list(directoryId, metadata, () =>
      readFolder(this.root, directoryId, metadata, signal, locate),
    );
    for await (const item of items) {
      signal.throwIfAborted();
      if ('entry' in item) {
        updateSummary(summary, item.entry);
        this.tracker.listed(item.entry);
      }
      yield item;
    }
    // A folder without covers of its own looks inside its subfolders when it is inspected.
    if (summary.covers.length > 0 || !summary.hasSubfolders) {
      this.summaries.remember(directoryId, summary, since);
    }
  }

  /** The entry at `id` as a scan would list it now, or `null` if there is none to list. */
  entryAt(id: string, parentId: string): Promise<PhotoEntry | null> {
    return this.tracker.current(id, parentId);
  }

  /**
   * What the paths the watcher saw are now, leaving out the ones that changed nothing shown.
   * Folders whose listing changed lose their remembered summaries, as do those holding them.
   * Any change drops the listings that show it, and those of the folders holding it, whose own
   * modification times it changes; a folder that went takes the listings inside it along.
   */
  async describeChanges(changes: PathChange[]): Promise<FolderChange[]> {
    const described = await this.tracker.describe(changes);
    const changed = new Set<string>();
    for (const { parentId } of described.filter((change) => change.listingChanged)) {
      for (let id = parentId; !changed.has(id); id = path.dirname(id)) {
        changed.add(id);
      }
    }
    this.forget(changed);
    const holding = new Set<string>();
    for (const { id, parentId, entry, listingChanged } of described) {
      for (let folder = parentId; !holding.has(folder); folder = path.dirname(folder)) {
        holding.add(folder);
      }
      if (listingChanged && entry?.kind !== 'directory') {
        this.listings.forgetInside(id);
      }
    }
    this.listings.forget(holding);
    return described;
  }

  /** Drops what is remembered of folders that changed on disk, or of every folder. */
  forget(directoryIds?: Iterable<string>): void {
    const ids = directoryIds && [...directoryIds];
    this.summaries.forget(ids);
    this.listings.forget(ids);
  }

  async close(): Promise<void> {
    this.controller.abort();
    await Promise.all([...this.scans.keys()].map((scanId) => this.cancelScan(scanId)));
    this.summaries.forget();
    this.listings.forget();
  }
}
