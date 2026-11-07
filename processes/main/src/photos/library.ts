import { ChangeTracker, type PathChange } from '#photos/changes';
import { ExifDetails } from '#photos/exif';
import { ListingCache } from '#photos/listings';
import { mediaKind, summarize } from '#photos/media';
import { PhotoIndex } from '#photos/photo-index';
import { Scans } from '#photos/scans';
import { SummaryCache } from '#photos/summaries';
import type { ThumbnailSource } from '#photos/thumbnails';
import { isWithin, requireScanOptions, requireString, requireStrings } from '#photos/validate';
import { Walker } from '#photos/walk';
import {
  type FolderChange,
  type FolderSummary,
  MAX_METADATA_IDS,
  type PhotoEntry,
  type PhotoExif,
  type PhotoMetadata,
  type ScanBatch,
  type ScanOptions,
} from '@prism/shared';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';

export class PhotoLibrary {
  readonly controller = new AbortController();
  private readonly scans = new Scans(
    (options, signal) => this.walker.walk(options, signal),
    this.controller.signal,
  );
  private readonly summaries = new SummaryCache();
  private readonly listings: ListingCache;
  private readonly tracker: ChangeTracker;
  private readonly exif: ExifDetails;
  private readonly walker: Walker;
  private constructor(
    readonly root: string,
    index: PhotoIndex,
  ) {
    this.tracker = new ChangeTracker(root);
    this.exif = new ExifDetails(index, root, this.controller.signal);
    this.listings = new ListingCache(index.listings(root), this.controller.signal);
    this.walker = new Walker({
      exif: this.exif,
      listings: this.listings,
      resolve: (id) => this.resolve(id),
      root,
      summaries: this.summaries,
      tracker: this.tracker,
    });
  }

  /**
   * Tells `listener` of paths that changed while nothing watched them, such as while the app
   * was closed, as folders shown from the index are read again. Describe them as the watcher's.
   */
  onStale(listener: (changes: PathChange[]) => void): void {
    this.listings.onStale(listener);
  }

  /** Opens the folder at `root`, which owns `index` from then on and closes it with itself. */
  static async open(root: string, index?: PhotoIndex): Promise<PhotoLibrary> {
    requireString(root);
    const canonical = await realpath(root);
    const info = await stat(canonical);
    if (!info.isDirectory()) {
      throw new Error('Select a directory.');
    }
    return new PhotoLibrary(canonical, index ?? PhotoIndex.open(':memory:'));
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
    requireScanOptions(options);
    return this.scans.start(options);
  }

  nextBatch(scanId: string): Promise<ScanBatch> {
    return this.scans.next(scanId);
  }

  cancelScan(scanId: string): Promise<void> {
    return this.scans.cancel(scanId);
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
      this.walker.walk({ directoryId, recursive }, this.controller.signal, maxFolders),
    );
    this.summaries.remember(directoryId, summary, since);
    return summary;
  }

  /** See `ChangeTracker.metadata`. */
  readMetadata(entryIds: string[]): Promise<(PhotoMetadata | null)[]> {
    requireStrings(entryIds, MAX_METADATA_IDS);
    return this.tracker.metadata(entryIds);
  }

  /** The EXIF details of photos scans listed, as they are now; `null` for any other entry. */
  readExif(entryIds: string[]): Promise<(PhotoExif | null)[]> {
    requireStrings(entryIds, MAX_METADATA_IDS);
    return Promise.all(
      entryIds.map(async (id) =>
        this.tracker.kindOf(id) === 'image' ? ((await this.exif.at(id)) ?? null) : null,
      ),
    );
  }

  /** The entry at `id` as a scan would list it now, or `null` if there is none to list. */
  async entryAt(id: string, parentId: string): Promise<PhotoEntry | null> {
    const entry = await this.tracker.current(id, parentId);
    return entry && this.exif.add(entry);
  }

  /**
   * What the paths the watcher saw are now, leaving out the ones that changed nothing shown.
   * Folders whose listing changed lose their remembered summaries, as do those holding them.
   * Any change drops the listings that show it, and those of the folders holding it, whose own
   * modification times it changes; a folder that went takes the listings inside it along.
   */
  async describeChanges(changes: PathChange[]): Promise<FolderChange[]> {
    const described = await this.tracker.describe(changes);
    // Changes go to every view, including those that sort by when photos were taken.
    await Promise.all(described.map(({ entry }) => entry && this.exif.add(entry)));
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
    await this.scans.close();
    this.summaries.forget();
    this.listings.close();
    this.exif.close();
  }
}
