import { mediaKind } from '#photos/media';
import type { FolderChange, PhotoEntry } from '@prism/shared';
import type { Stats } from 'node:fs';
import { lstat } from 'node:fs/promises';
import path from 'node:path';
import pLimit from 'p-limit';

// Paths a burst of events names are looked at this many at a time.
const LOOKUP_CONCURRENCY = 16;

/** A path the watcher saw change, before anyone has looked at what it is now. */
export interface PathChange {
  id: string;
  parentId: string;
}

/** Size and modification time: enough to tell rewritten contents apart. */
function signature(size: number, modifiedMs: number) {
  return `${size}:${modifiedMs}`;
}

/**
 * Remembers what the app has been shown, so a burst of file events becomes the few entries
 * that actually changed. The system reports events for writes that change nothing, such as
 * metadata a viewer adds, and sometimes for files created just before watching began.
 */
export class ChangeTracker {
  /** Kinds of the entries scans have listed. */
  private readonly kinds = new Map<string, PhotoEntry['kind']>();
  /** Last known size and modification time of listed or read files. */
  private readonly signatures = new Map<string, string>();
  /** Files whose original or thumbnail was read, so their contents matter. */
  private readonly read = new Set<string>();
  /** The IDs known inside each folder, so a removed folder's contents are found directly. */
  private readonly children = new Map<string, Set<string>>();

  constructor(private readonly root: string) {}

  private track(id: string, parentId: string) {
    let inside = this.children.get(parentId);
    if (!inside) {
      inside = new Set();
      this.children.set(parentId, inside);
    }
    inside.add(id);
  }

  listed(entry: PhotoEntry): void {
    this.track(entry.id, entry.parentId);
    this.kinds.set(entry.id, entry.kind);
    if (entry.metadata) {
      this.signatures.set(entry.id, signature(entry.metadata.size, entry.metadata.modifiedMs));
    }
  }

  /**
   * `info` is the file as its original or thumbnail was read. A file already known keeps what
   * it was known as: reading it again after it changed, before the watcher's event arrives,
   * must not hide the change from what still shows it as it was.
   */
  opened(entryId: string, info: Stats): void {
    this.track(entryId, path.dirname(entryId));
    this.read.add(entryId);
    if (!this.signatures.has(entryId)) {
      this.signatures.set(entryId, signature(info.size, info.mtimeMs));
    }
  }

  /** What each path is now, leaving out the ones that changed nothing the app has seen. */
  async describe(changes: PathChange[]): Promise<FolderChange[]> {
    const limit = pLimit(LOOKUP_CONCURRENCY);
    const entries = await Promise.all(
      changes.map(({ id, parentId }) =>
        id === '.' ? undefined : limit(() => this.current(id, parentId)),
      ),
    );
    const described: FolderChange[] = [];
    for (const [index, { id, parentId }] of changes.entries()) {
      const entry = entries[index];
      const before = this.signatures.get(id);
      const now = entry?.metadata && signature(entry.metadata.size, entry.metadata.modifiedMs);
      const listingChanged = this.kinds.get(id) !== entry?.kind;
      const contentChanged = this.read.has(id) && before !== now;
      // Unknown metadata was never shown, so it cannot be out of date.
      if (entry !== undefined && (listingChanged || (before !== undefined && before !== now))) {
        described.push({ contentChanged, entry, id, listingChanged, parentId });
        this.remember(id, entry);
      }
    }
    return described;
  }

  private remember(id: string, entry: PhotoEntry | null) {
    if (entry) {
      this.read.delete(id);
      this.listed(entry);
      return;
    }
    // A removed folder takes everything inside it along.
    this.children.get(path.dirname(id))?.delete(id);
    const removed = [id];
    for (let current = removed.pop(); current !== undefined; current = removed.pop()) {
      this.kinds.delete(current);
      this.signatures.delete(current);
      this.read.delete(current);
      for (const child of this.children.get(current) ?? []) {
        removed.push(child);
      }
      this.children.delete(current);
    }
  }

  /** The entry at `id` as a scan would list it, or `null` if there is none to list. */
  async current(id: string, parentId: string): Promise<PhotoEntry | null> {
    let info: Stats;
    try {
      info = await lstat(path.join(this.root, id));
    } catch {
      return null;
    }
    if (info.isSymbolicLink()) {
      return null;
    }
    let kind: PhotoEntry['kind'] = 'file';
    if (info.isDirectory()) {
      kind = 'directory';
    } else if (info.isFile()) {
      kind = mediaKind(id) ?? 'file';
    }
    const metadata = {
      accessedMs: info.atimeMs,
      createdMs: info.birthtimeMs,
      modifiedMs: info.mtimeMs,
      size: info.size,
    };
    return { id, kind, metadata, name: path.basename(id), parentId };
  }
}
