import type { Want } from '#photos/worker/scheduler';
import type { Priority } from '#photos/worker/scheduling';
import type { ScreenContents, VisibleRows } from '@prism/shared';

function visibleIf(shown: boolean): Priority | null {
  return shown ? 'visible' : null;
}

/**
 * What the folder's window last said it has on show, which every job the scheduler weighs asks
 * of. A folder's worker serves one window.
 */
export class ReportedAttention {
  #shown = new Set<string>();
  #tiles = new Set<string>();
  #views: VisibleRows[] = [];

  /**
   * Takes what the window has on show now, in place of what it said before; returns the entries
   * it shows that it did not before.
   */
  update({ shown, foldersToRead: tiles, views }: ScreenContents): string[] {
    const before = this.#shown;
    this.#shown = new Set(shown);
    this.#tiles = new Set(tiles);
    this.#views = views;
    return shown.filter((entryId) => !before.has(entryId));
  }

  /** Entries whose thumbnails or originals are on show. */
  get shown(): ReadonlySet<string> {
    return this.#shown;
  }

  /** Folders on show whose tiles may not say all they will. */
  get tiles(): ReadonlySet<string> {
    return this.#tiles;
  }

  /** The rows each gallery shows. */
  get views(): readonly VisibleRows[] {
    return this.#views;
  }

  /** How much the window wants the thumbnail of `entryId` made: while it shows it. */
  entry(entryId: string): Want {
    return () => visibleIf(this.#shown.has(entryId));
  }

  /** How much the window wants the tile of `folderId` read: while it shows it. */
  tile(folderId: string): Want {
    return () => visibleIf(this.#tiles.has(folderId));
  }
}
