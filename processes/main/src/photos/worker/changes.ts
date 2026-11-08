import type { KnownItem } from '@prism/catalog';
import { mediaKind } from '@prism/media';
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

/**
 * Files whose original or thumbnail was read, so their contents matter, by the signature they
 * had then. A change is told by that signature before the catalog's: the catalog can learn of a
 * rewrite first, as a folder read again lists it, and the window still shows what it read.
 * Reading a file again after it changed, before the watcher's event arrives, keeps the
 * signature it was first read at, for the same reason.
 */
export type ReadFiles = Map<string, string>;

/** A changed path, as it is on disk now and as the catalog and the window last knew it. */
export interface Observed extends PathChange {
  /** `null` if nothing is there to list; `undefined` for the library's own folder. */
  entry: PhotoEntry | null | undefined;
  known: KnownItem | undefined;
  /** The file's signature when its contents were read, if they were. */
  read: string | undefined;
}

/** Size and modification time: enough to tell rewritten contents apart. */
function signature(size: number, modifiedMs: number) {
  return `${size}:${modifiedMs}`;
}

/** The entry at `id` inside `root` as a read would list it, or `null` if there is none to list. */
export async function entryOnDisk(
  root: string,
  id: string,
  parentId: string,
): Promise<PhotoEntry | null> {
  let info: Stats;
  try {
    info = await lstat(path.join(root, id));
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

/** Notes that the contents of `entryId` were read, as `info` says the file was then. */
export function noteRead(read: ReadFiles, entryId: string, info: Stats): void {
  if (!read.has(entryId)) {
    read.set(entryId, signature(info.size, info.mtimeMs));
  }
}

/** Whether `id` is inside one of `folders`. IDs are paths relative to the library's folder. */
function insideAny(folders: Set<string>, id: string) {
  for (let parent = path.dirname(id); parent !== '.'; parent = path.dirname(parent)) {
    if (folders.has(parent)) {
      return true;
    }
  }
  return false;
}

/**
 * The few entries a burst of file events actually changed. The system reports events for
 * writes that change nothing, such as metadata a viewer adds, and sometimes for files created
 * just before watching began. A folder removed takes what was inside it along, so the paths
 * inside it are left out.
 */
export function describe(observed: Observed[]): FolderChange[] {
  const removedFolders = new Set(
    observed
      .filter(({ entry, known }) => entry === null && known?.kind === 'directory')
      .map(({ id }) => id),
  );
  return observed.flatMap(({ entry, id, known, parentId, read }) => {
    if (entry === undefined || insideAny(removedFolders, id)) {
      return [];
    }
    const before =
      read ??
      (known && known.size !== null && known.modifiedMs !== null
        ? signature(known.size, known.modifiedMs)
        : undefined);
    const now = entry?.metadata && signature(entry.metadata.size, entry.metadata.modifiedMs);
    const listingChanged = known?.kind !== entry?.kind;
    const contentChanged = read !== undefined && before !== now;
    // Unknown metadata was never shown, so it cannot be out of date.
    return listingChanged || (before !== undefined && before !== now)
      ? [{ contentChanged, entry, id, listingChanged, parentId }]
      : [];
  });
}

/** What the changed paths are on disk now, and what the catalog and the window knew of them. */
export async function observe(
  root: string,
  changes: PathChange[],
  read: ReadFiles,
  lookup: (ids: string[]) => Promise<KnownItem[]>,
): Promise<Observed[]> {
  const limit = pLimit(LOOKUP_CONCURRENCY);
  const ids = changes.map(({ id }) => id).filter((id) => id !== '.');
  const [entries, known] = await Promise.all([
    Promise.all(
      changes.map(({ id, parentId }) =>
        id === '.' ? undefined : limit(() => entryOnDisk(root, id, parentId)),
      ),
    ),
    // Without it, every change is described as new.
    ids.length === 0 ? [] : lookup(ids).catch((): KnownItem[] => []),
  ]);
  const byId = new Map(known.map((item) => [item.id, item]));
  return changes.map((change, index) => ({
    ...change,
    entry: entries[index],
    known: byId.get(change.id),
    read: read.get(change.id),
  }));
}

/** Forgets the reads of files `described` changed, and of everything inside removed folders. */
export function forgetRead(read: ReadFiles, described: FolderChange[]): void {
  const removed = new Set(described.filter(({ entry }) => !entry).map(({ id }) => id));
  for (const { id } of described) {
    read.delete(id);
  }
  if (removed.size > 0) {
    for (const id of read.keys()) {
      if (insideAny(removed, id)) {
        read.delete(id);
      }
    }
  }
}
