import { ChangeTracker, type PathChange } from '#photos/changes';
import { errorMessage } from '#photos/errors';
import { hasBestCovers, isIgnored, mediaKind, updateSummary } from '#photos/media';
import type {
  FolderChange,
  FolderSummary,
  PhotoEntry,
  ScanBatch,
  ScanOptions
} from '@prism/shared';
import { randomUUID } from 'node:crypto';
import { opendir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

const MAX_ID_LENGTH = 32_768,
  MAX_EXCLUSIONS = 10_000,
  BATCH_SIZE = 128,
  MAX_DEPTH = 128,
  MAX_SCANS = 4,
  MAX_SUMMARIES = 256,
  SUMMARY_TTL_MS = 2000;
type ScanItem = { entry: PhotoEntry } | { error: ScanBatch['errors'][number] };
interface Scan {
  controller: AbortController;
  iterator: AsyncGenerator<ScanItem, void>;
  busy: boolean;
}

export function requireString(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_ID_LENGTH) {
    throw new Error('Expected a nonempty string.');
  }
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
  private readonly summaries = new Map<string, { value: FolderSummary; at: number }>();
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

  async original(entryId: string): Promise<string> {
    const source = await this.resolve(entryId);
    const info = await stat(source);
    if (!mediaKind(source) || !info.isFile()) {
      throw new Error('Entry is not a supported photo or video.');
    }
    this.tracker.opened(entryId, info);
    return source;
  }

  startScan(options: ScanOptions): string {
    this.controller.signal.throwIfAborted();
    if (!options || typeof options !== 'object') {
      throw new Error('Invalid scan options.');
    }
    requireString(options.directoryId);
    if (
      ('recursive' in options && typeof options.recursive !== 'boolean') ||
      ('metadata' in options && typeof options.metadata !== 'boolean') ||
      ('excludeDirectoryIds' in options &&
        (!Array.isArray(options.excludeDirectoryIds) ||
          options.excludeDirectoryIds.length > MAX_EXCLUSIONS ||
          !options.excludeDirectoryIds.every(
            (id) => typeof id === 'string' && id.length <= MAX_ID_LENGTH
          )))
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
      iterator: this.walk(options, controller.signal, 0)
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
      for (let count = 0; count < BATCH_SIZE; count += 1) {
        scan.controller.signal.throwIfAborted();
        this.controller.signal.throwIfAborted();
        const item = await scan.iterator.next();
        scan.controller.signal.throwIfAborted();
        this.controller.signal.throwIfAborted();
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
    if (cached && Date.now() - cached.at < SUMMARY_TTL_MS) {
      return Promise.resolve(cached.value);
    }
    return this.readSummary(directoryId);
  }

  private async readSummary(directoryId: string): Promise<FolderSummary> {
    const summary: FolderSummary = { covers: [], hasEntries: false, hasSubfolders: false };
    for await (const item of this.walk({ directoryId }, this.controller.signal, 0)) {
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
    this.summaries.set(directoryId, { at: Date.now(), value });
  }

  private async *walk(
    options: ScanOptions,
    signal: AbortSignal,
    depth: number
  ): AsyncGenerator<ScanItem, void> {
    const summary: FolderSummary = { covers: [], hasEntries: false, hasSubfolders: false };
    try {
      if (depth > MAX_DEPTH) {
        throw new Error('Directory nesting exceeds the scan depth limit.');
      }
      const directory = await this.resolve(options.directoryId),
        handle = await opendir(directory);
      // Async iteration closes the directory on completion, cancellation, and errors.
      for await (const entry of handle) {
        signal.throwIfAborted();
        this.controller.signal.throwIfAborted();
        if (entry.isSymbolicLink() || isIgnored(entry.name)) {
          continue;
        }
        const entryId = path.relative(this.root, path.join(directory, entry.name));
        if (
          entry.isDirectory() &&
          options.excludeDirectoryIds &&
          options.excludeDirectoryIds.includes(entryId)
        ) {
          continue;
        }
        const value: PhotoEntry = {
          id: entryId,
          kind: entry.isDirectory() ? 'directory' : 'file',
          name: entry.name,
          parentId: options.directoryId
        };
        const kind = entry.isFile() && mediaKind(entry.name);
        if (kind) {
          value.kind = kind;
        }
        updateSummary(summary, value);
        if (options.metadata) {
          try {
            const info = await stat(await this.resolve(entryId));
            value.metadata = {
              accessedMs: info.atimeMs,
              createdMs: info.birthtimeMs,
              modifiedMs: info.mtimeMs,
              size: info.size
            };
          } catch (error) {
            yield { error: { entryId, message: errorMessage(error) } };
          }
        }
        this.tracker.listed(value);
        yield { entry: value };
        if (options.recursive && entry.isDirectory()) {
          yield* this.walk({ ...options, directoryId: entryId }, signal, depth + 1);
        }
      }
      if (!options.excludeDirectoryIds?.length) {
        this.rememberSummary(options.directoryId, summary);
      }
    } catch (error) {
      signal.throwIfAborted();
      this.controller.signal.throwIfAborted();
      yield { error: { entryId: options.directoryId, message: errorMessage(error) } };
    }
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
      described.filter((change) => change.listingChanged).map((change) => change.parentId)
    );
    return described;
  }

  /** Drops remembered summaries of folders that changed on disk, or of every folder. */
  forget(directoryIds?: Iterable<string>): void {
    for (const directoryId of directoryIds ?? [...this.summaries.keys()]) {
      this.summaries.delete(directoryId);
    }
  }

  async close(): Promise<void> {
    this.controller.abort();
    await Promise.all([...this.scans.keys()].map((scanId) => this.cancelScan(scanId)));
    this.summaries.clear();
  }
}
