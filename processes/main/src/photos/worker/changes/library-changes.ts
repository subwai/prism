import {
  changedFolders,
  describeChanges,
  observeChanges,
  type PathChange,
} from '#photos/worker/changes/describe-changes';
import {
  moveShownFiles,
  type ShownFiles,
  updateShownFiles,
} from '#photos/worker/changes/shown-files';
import type { Share } from '#photos/worker/disk/share/share';
import type { Indexer } from '#photos/worker/indexer/indexer';
import { ALWAYS_VISIBLE } from '#photos/worker/scheduler/scheduler';
import type { LibraryViews } from '#photos/worker/views/library-views';
import type { Catalog } from '@prism/catalog';
import { type FolderChange, OneAfterAnother, type PhotoEntry } from '@prism/shared';
import path from 'node:path';

export interface LibraryChangeSources {
  root: string;
  catalog: Catalog;
  indexer: Indexer;
  views: LibraryViews;
  /** Whether the library's folder can be reached, which a change that seems to remove asks. */
  share: Share;
  /** Files whose contents the window was shown, which a change then shows again. */
  shownFiles: ShownFiles;
  /** Stops the reads of folders that changes bring in, as the library closes. */
  signal: AbortSignal;
}

/**
 * Writes what changes in a library's folder to the catalog, whether the watcher saw it or the app
 * made it. Changes on disk are compared with what the catalog holds, and the app's own moves move
 * the catalog's rows along with the files.
 */
export class LibraryChanges {
  /** The moves the app is making, one after another, which the watcher's reports wait for; see `move`. */
  private readonly moves = new OneAfterAnother();

  constructor(private readonly sources: LibraryChangeSources) {}

  /**
   * Looks at what the paths the watcher saw are now, writes the changes to the catalog, and
   * settles with them once the catalog has them. Paths that changed nothing shown are left out.
   * Folders whose contents changed, and the folders holding them, are read again when next asked
   * for.
   */
  async describe(changes: PathChange[]): Promise<FolderChange[]> {
    // The watcher may have seen a move the app is making, which the catalog then has already.
    await this.moves.done();
    return this.write(changes);
  }

  private async write(changes: PathChange[]): Promise<FolderChange[]> {
    const { catalog, root, share, shownFiles, views } = this.sources;
    // Compared with every write so far, such as a rating's rewrite, which then changes nothing.
    await catalog.committed();
    const observed = await observeChanges({
      changes,
      lookup: (ids) => catalog.call('knownItemsAt', ids),
      root,
      shown: shownFiles,
    });
    // Paths the watcher saw just before the volume went away cannot be looked at, and that says
    // nothing about whether they are gone. When it comes back, that is sent as a change to everything.
    if (observed.some(({ entry }) => entry === null) && !(await share.isVolumeThere())) {
      return [];
    }
    const described = describeChanges(observed);
    updateShownFiles(shownFiles, described);
    views.forget(changedFolders(described));
    this.writeToCatalog(described);
    return catalog.committed().then(() => described);
  }

  /**
   * Moves the entry `from` to `to`: on disk with `onDisk`, which returns what is at `to` after,
   * and in the catalog.
   * - The catalog's rows of the entry and everything inside it move in place, with their
   *   ratings, so nothing inside is read again. A moved folder is read again itself, to confirm.
   * - If the catalog cannot move them, as when it has something at `to` already, it learns of the
   *   move as of any change on disk, and reads what arrived in full.
   * Returns the changes the window applies, or `null` if there is nothing at `to` to list.
   */
  move(
    from: string,
    to: string,
    onDisk: () => Promise<PhotoEntry | null>,
  ): Promise<{ entry: PhotoEntry; changes: FolderChange[] } | null> {
    return this.moves.run(async () => {
      const entry = await onDisk();
      if (!entry) {
        return null;
      }
      const left = { contentChanged: false, entry: null, id: from, parentId: path.dirname(from) };
      const changes: FolderChange[] = [
        { ...left, folderContentsChanged: true },
        {
          contentChanged: false,
          entry,
          folderContentsChanged: true,
          id: to,
          parentId: entry.parentId,
        },
      ];
      await this.moveRows(from, entry, changes);
      return { changes, entry };
    });
  }

  private async moveRows(from: string, entry: PhotoEntry, changes: FolderChange[]) {
    const { catalog, indexer, shownFiles, views } = this.sources;
    if (!(await catalog.call('move', from, entry.id).catch(() => false))) {
      await this.write(changes);
      return;
    }
    moveShownFiles(shownFiles, from, entry.id);
    indexer.moved(from, entry.id);
    // Listed as the disk has it now, because a move may change a folder's times.
    catalog.write({ entries: [entry], kind: 'list' });
    // The folders it left and arrived in changed, so they are read again when next asked for.
    views.forget(changedFolders(changes));
    if (entry.kind === 'directory') {
      views.forget([entry.id]);
      indexer.readIntoCatalog(entry.id, ALWAYS_VISIBLE).catch(() => null);
    }
    await catalog.committed();
  }

  /**
   * Writes what changed on disk to the catalog, so views show it without reading their folders
   * again. A folder that appeared, as one moved in does, raises no events for what it holds, so
   * it is read in full.
   */
  private writeToCatalog(described: FolderChange[]): void {
    const { catalog, indexer, signal, views } = this.sources;
    const listed = described.flatMap(({ entry }) => (entry ? [entry] : []));
    const removed = described.filter(({ entry }) => !entry).map(({ id }) => id);
    if (listed.length > 0) {
      catalog.write({ entries: listed, kind: 'list' });
      views.wakeDetailsReader();
    }
    if (removed.length > 0) {
      catalog.write({ ids: removed, kind: 'remove' });
      for (const id of removed) {
        indexer.forgetInside(id);
      }
    }
    for (const { entry, folderContentsChanged } of described) {
      if (entry?.kind === 'directory' && folderContentsChanged) {
        indexer.forgetInside(entry.id);
        indexer.index({ directoryId: entry.id, recursive: true }, signal, { fullRead: true });
      }
    }
  }
}
