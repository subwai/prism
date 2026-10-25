import { ChangeTracker, type PathChange } from '#photos/changes';
import { errorMessage } from '#photos/errors';
import { emptySummary, hasBestCovers, isIgnored, mediaKind, updateSummary } from '#photos/media';
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
import { readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

const BATCH_SIZE = 128,
  // Only a folder linked inside itself goes this deep; symbolic links are skipped already.
  MAX_DEPTH = 1024,
  MAX_SCANS = 4,
  MAX_SUMMARIES = 2048,
  // Metadata is read this many files at a time.
  STAT_BATCH = 64;
type ScanItem = { entry: PhotoEntry } | { error: ScanBatch['errors'][number] };
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
  /**
   * What scans and inspections found directly inside each folder, until the watcher sees it
   * change or the window refreshes.
   */
  private readonly summaries = new Map<string, FolderSummary>();
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
    const summary = emptySummary();
    for await (const item of this.walk({ directoryId }, this.controller.signal)) {
      if ('error' in item) {
        throw new Error(item.error.message);
      }
      updateSummary(summary, item.entry);
      if (summary.hasSubfolders && hasBestCovers(summary)) {
        break;
      }
    }
    this.rememberSummary(directoryId, summary);
    return summary;
  }

  private rememberSummary(directoryId: string, value: FolderSummary): void {
    this.summaries.delete(directoryId);
    if (this.summaries.size >= MAX_SUMMARIES) {
      const oldest = this.summaries.keys().next();
      if (!oldest.done) {
        this.summaries.delete(oldest.value);
      }
    }
    this.summaries.set(directoryId, value);
  }

  /**
   * Lists `options.directoryId`, and with `recursive` every folder inside it, breadth first:
   * the shallowest photos arrive first, and only one folder is open at a time however deep
   * the tree goes.
   */
  private async *walk(options: ScanOptions, signal: AbortSignal): AsyncGenerator<ScanItem, void> {
    const folders = [{ depth: 0, id: options.directoryId }];
    // Folders found along the way join the end of the list this loop is going through.
    for (const folder of folders) {
      try {
        if (folder.depth > MAX_DEPTH) {
          throw new Error('Directory nesting exceeds the scan depth limit.');
        }
        for await (const item of this.list(folder.id, options.metadata ?? false, signal)) {
          yield item;
          if (options.recursive && 'entry' in item && item.entry.kind === 'directory') {
            folders.push({ depth: folder.depth + 1, id: item.entry.id });
          }
        }
      } catch (error) {
        signal.throwIfAborted();
        yield { error: { entryId: folder.id, message: errorMessage(error) } };
      }
    }
  }

  /** The entries directly inside a folder, with their `metadata` if asked for. */
  private async *list(
    directoryId: string,
    metadata: boolean,
    signal: AbortSignal,
  ): AsyncGenerator<ScanItem, void> {
    const directory = await this.resolve(directoryId);
    // Entry IDs are relative to the canonical root, as resolving them expects.
    const base = path.relative(this.root, directory);
    const listing = (await readdir(directory, { withFileTypes: true })).filter(
      (dirent) => !dirent.isSymbolicLink() && !isIgnored(dirent.name),
    );
    const summary = emptySummary();
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
        updateSummary(summary, entry);
        this.tracker.listed(entry);
        yield { entry };
      }
    }
    this.rememberSummary(directoryId, summary);
  }

  /** The entry at `id` as a scan would list it now, or `null` if there is none to list. */
  entryAt(id: string, parentId: string): Promise<PhotoEntry | null> {
    return this.tracker.current(id, parentId);
  }

  /**
   * What the paths the watcher saw are now, leaving out the ones that changed nothing shown.
   * Folders whose listing changed lose their remembered summaries.
   */
  async describeChanges(changes: PathChange[]): Promise<FolderChange[]> {
    const described = await this.tracker.describe(changes);
    this.forget(
      described.filter((change) => change.listingChanged).map((change) => change.parentId),
    );
    return described;
  }

  /** Drops remembered summaries of folders that changed on disk, or of every folder. */
  forget(directoryIds?: Iterable<string>): void {
    if (!directoryIds) {
      this.summaries.clear();
      return;
    }
    for (const directoryId of directoryIds) {
      this.summaries.delete(directoryId);
    }
  }

  async close(): Promise<void> {
    this.controller.abort();
    await Promise.all([...this.scans.keys()].map((scanId) => this.cancelScan(scanId)));
    this.summaries.clear();
  }
}
