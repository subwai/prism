import type { Priority } from '#photos/worker/scheduler/limits';
import type { CurrentPriority } from '#photos/worker/scheduler/scheduler';
import type { ScreenContents, VisibleRows } from '@prism/shared';

function visibleIf(isShown: boolean): Priority | null {
  return isShown ? 'visible' : null;
}

/**
 * What the folder's window last said it has on screen. The scheduler's jobs for thumbnails
 * and tiles ask it for their priority. A folder's worker serves one window.
 */
export class LatestScreenContents {
  #shown = new Set<string>();
  #foldersToRead = new Set<string>();
  #views: VisibleRows[] = [];

  /**
   * Replaces what the window said before with what it has on screen now. Returns the entries
   * that are newly on screen.
   */
  update({ shown, foldersToRead, views }: ScreenContents): string[] {
    const before = this.#shown;
    this.#shown = new Set(shown);
    this.#foldersToRead = new Set(foldersToRead);
    this.#views = views;
    return shown.filter((entryId) => !before.has(entryId));
  }

  /** Entries whose thumbnails or originals are on screen. */
  get shown(): ReadonlySet<string> {
    return this.#shown;
  }

  /** Folders on screen whose tiles may not yet show everything they will. */
  get foldersToRead(): ReadonlySet<string> {
    return this.#foldersToRead;
  }

  /** The rows each gallery shows. */
  get views(): readonly VisibleRows[] {
    return this.#views;
  }

  /** The priority of making the thumbnail of `entryId`: visible while it is on screen. */
  thumbnailPriority(entryId: string): CurrentPriority {
    return () => visibleIf(this.#shown.has(entryId));
  }

  /** The priority of reading the tile of `folderId`: visible while it is on screen. */
  tilePriority(folderId: string): CurrentPriority {
    return () => visibleIf(this.#foldersToRead.has(folderId));
  }
}
