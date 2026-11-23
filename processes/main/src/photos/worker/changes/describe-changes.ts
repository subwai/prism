import { contentSignature, type ShownFiles } from '#photos/worker/changes/shown-files';
import { entryOnDisk } from '#photos/worker/disk/entry-on-disk';
import { isInsideAny } from '#photos/worker/library/entry-ids';
import type { KnownItem } from '@prism/catalog';
import type { FolderChange, PhotoEntry } from '@prism/shared';
import path from 'node:path';
import pLimit from 'p-limit';

// Paths a burst of events names are looked at this many at a time.
const LOOKUP_CONCURRENCY = 16;

/** A path the watcher saw change, before anyone has looked at what it is now. */
export interface PathChange {
  id: string;
  parentId: string;
}

/** A changed path: what is on disk now, and what the catalog and the window last knew of it. */
export interface ObservedChange extends PathChange {
  /** `null` if nothing is there to list; `undefined` for the library's own folder. */
  entry: PhotoEntry | null | undefined;
  known: KnownItem | undefined;
  /** The file's content signature when the window was shown it, if it was. */
  shownAs: string | undefined;
}

/**
 * The few entries a burst of file events actually changed. The system reports events for
 * writes that change nothing, such as metadata a viewer adds, and sometimes for files created
 * just before watching began. A removed folder takes its contents with it, so the paths inside
 * it are left out.
 */
export function describeChanges(observed: ObservedChange[]): FolderChange[] {
  const removedFolders = new Set(
    observed
      .filter(({ entry, known }) => entry === null && known?.kind === 'directory')
      .map(({ id }) => id),
  );
  return observed.flatMap(({ entry, id, known, parentId, shownAs }) => {
    if (entry === undefined || isInsideAny(removedFolders, id)) {
      return [];
    }
    const before =
      shownAs ??
      (known && known.size !== null && known.modifiedMs !== null
        ? contentSignature(known.size, known.modifiedMs)
        : undefined);
    const now = entry?.metadata && contentSignature(entry.metadata.size, entry.metadata.modifiedMs);
    const listingChanged = known?.kind !== entry?.kind;
    const contentChanged = shownAs !== undefined && before !== now;
    // Unknown metadata was never shown, so it cannot be out of date.
    return listingChanged || (before !== undefined && before !== now)
      ? [{ contentChanged, entry, id, listingChanged, parentId }]
      : [];
  });
}

/** Looks at what the changed paths are on disk now, beside what the catalog and window knew. */
export async function observeChanges(
  root: string,
  changes: PathChange[],
  shown: ShownFiles,
  lookup: (ids: string[]) => Promise<KnownItem[]>,
): Promise<ObservedChange[]> {
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
    shownAs: shown.get(change.id),
  }));
}

/** The folders holding each change that altered a listing, up to the library's own. */
export function changedFolders(described: FolderChange[]): string[] {
  const changed = new Set<string>();
  for (const { parentId } of described.filter((change) => change.listingChanged)) {
    for (let id = parentId; !changed.has(id); id = path.dirname(id)) {
      changed.add(id);
    }
  }
  return [...changed];
}
