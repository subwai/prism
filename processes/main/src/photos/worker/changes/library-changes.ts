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
import type { Indexer } from '#photos/worker/indexer/indexer';
import { ALWAYS_VISIBLE } from '#photos/worker/scheduler/scheduler';
import type { Share } from '#photos/worker/share/share';
import type { LibraryViews } from '#photos/worker/views/library-views';
import type { Catalog } from '@prism/catalog';
import type { FolderChange, PhotoEntry } from '@prism/shared';
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
}

/**
 * What changes in a library's folder, as the watcher sees it or the app makes it, written to
 * the catalog: changes on disk are compared with what the catalog holds, and the app's own
 * moves move the catalog's rows with them.
 */
export class LibraryChanges {
  /** The moves the app is making, which the watcher's reports wait for; see `move`. */
  private moving: Promise<unknown> = Promise.resolve();

  constructor(private readonly sources: LibraryChangeSources) {}

  /**
   * What the paths the watcher saw are now, leaving out the ones that changed nothing shown,
   * written to the catalog, settling once it has them. Folders whose listing changed are read
   * again when next asked for, as are those holding them.
   */
  async describe(changes: PathChange[]): Promise<FolderChange[]> {
    // A move the app makes may be what they saw, which the catalog then has already.
    await this.moving;
    return this.write(changes);
  }

  private async write(changes: PathChange[]): Promise<FolderChange[]> {
    const { catalog, root, share, shownFiles, views } = this.sources;
    // Compared with every write so far, such as a rewrite's, which then changes nothing.
    await catalog.committed();
    const observed = await observeChanges(root, changes, shownFiles, (ids) =>
      catalog.call('knownItemsAt', ids),
    );
    // Paths the watcher saw just before the volume went are not there to look at, which says
    // nothing of whether they went. Its return is told as a change to everything.
    if (observed.some(({ entry }) => entry === null) && !(await share.isVolumeThere())) {
      return [];
    }
    const described = describeChanges(observed);
    updateShownFiles(shownFiles, described);
    views.forget(changedFolders(described));
    views.apply(described);
    return catalog.committed().then(() => described);
  }

  /**
   * Moves the entry `from` to `to` on disk with `onDisk`, which then says what is at `to`, and
   * the catalog's rows of it, and of everything inside it, with it, in place, with their ratings,
   * so nothing inside is read again. A folder moved is read again itself, to confirm. If the
   * catalog cannot move them, as when it has something at `to` already, it learns of the move as
   * of any change on disk, and reads what came in full. Returns the changes the window applies,
   * or `null` if nothing is at `to` to list.
   */
  move(
    from: string,
    to: string,
    onDisk: () => Promise<PhotoEntry | null>,
  ): Promise<{ entry: PhotoEntry; changes: FolderChange[] } | null> {
    const moved = this.moving.then(async () => {
      const entry = await onDisk();
      if (!entry) {
        return null;
      }
      const left = { contentChanged: false, entry: null, id: from, parentId: path.dirname(from) };
      const changes: FolderChange[] = [
        { ...left, listingChanged: true },
        { contentChanged: false, entry, id: to, listingChanged: true, parentId: entry.parentId },
      ];
      await this.moveRows(from, entry, changes);
      return { changes, entry };
    });
    this.moving = moved.catch(() => null);
    return moved;
  }

  private async moveRows(from: string, entry: PhotoEntry, changes: FolderChange[]) {
    const { catalog, indexer, shownFiles, views } = this.sources;
    if (!(await catalog.call('move', from, entry.id).catch(() => false))) {
      await this.write(changes);
      return;
    }
    moveShownFiles(shownFiles, from, entry.id);
    indexer.moved(from, entry.id);
    // As the disk has it now, as a move may change a folder's times.
    catalog.write({ entries: [entry], kind: 'list' });
    // The folders it left and came to are read again when next asked for, as they changed.
    views.forget(changedFolders(changes));
    if (entry.kind === 'directory') {
      views.forget([entry.id]);
      indexer.readIntoCatalog(entry.id, ALWAYS_VISIBLE).catch(() => null);
    }
    await catalog.committed();
  }
}
