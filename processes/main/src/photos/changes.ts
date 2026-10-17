import { mediaKind } from '#photos/media';
import type { FolderChange, PhotoEntry } from '@app/shared';
import type { Stats } from 'node:fs';
import { lstat } from 'node:fs/promises';
import path from 'node:path';

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

  constructor(private readonly root: string) {}

  listed(entry: PhotoEntry): void {
    this.kinds.set(entry.id, entry.kind);
    if (entry.metadata) {
      this.signatures.set(entry.id, signature(entry.metadata.size, entry.metadata.modifiedMs));
    }
  }

  /** `info` is the file as its original or thumbnail was read. */
  opened(entryId: string, info: Stats): void {
    this.read.add(entryId);
    this.signatures.set(entryId, signature(info.size, info.mtimeMs));
  }

  /** What each path is now, leaving out the ones that changed nothing the app has seen. */
  async describe(changes: PathChange[]): Promise<FolderChange[]> {
    const described: FolderChange[] = [];
    for (const { id, parentId } of changes) {
      const entry = id === '.' ? undefined : await this.current(id, parentId);
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
    const inside = `${id}${path.sep}`;
    for (const map of [this.kinds, this.signatures]) {
      for (const key of map.keys()) {
        if (key === id || key.startsWith(inside)) {
          map.delete(key);
        }
      }
    }
    for (const key of this.read) {
      if (key === id || key.startsWith(inside)) {
        this.read.delete(key);
      }
    }
  }

  /** The entry at `id` as a scan would list it, or `null` if there is none to list. */
  private async current(id: string, parentId: string): Promise<PhotoEntry | null> {
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
      size: info.size
    };
    return { id, kind, metadata, name: path.basename(id), parentId };
  }
}
