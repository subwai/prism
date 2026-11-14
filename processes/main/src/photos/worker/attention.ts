import type { Want } from '#photos/worker/scheduler';
import type { Priority } from '#photos/worker/scheduling';
import type { AttendedRows, Attention } from '@prism/shared';

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
  #views: AttendedRows[] = [];
  /** How many times the window has said, so work asked for since can tell it is newer. */
  #heard = 0;
  readonly #listeners = new Set<() => void>();

  /** Takes what the window has on show now, in place of what it said before. */
  update({ shown, tiles, views }: Attention): void {
    this.#shown = new Set(shown);
    this.#tiles = new Set(tiles);
    this.#views = views;
    this.#heard += 1;
    for (const listener of this.#listeners) {
      listener();
    }
  }

  /** Hears each time the window says what it shows; returns the unsubscribe function. */
  onChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Folders on show whose tiles may not say all they will. */
  get tiles(): ReadonlySet<string> {
    return this.#tiles;
  }

  /** The rows each gallery shows. */
  get views(): readonly AttendedRows[] {
    return this.#views;
  }

  /**
   * How much the window wants what it asked for of `entryId` now: on show while the window
   * shows it, and until it next says what it shows, as it asks for what it is about to show
   * before saying it shows it. Once it says otherwise, nothing wants it.
   */
  asked(entryId: string): Want {
    const at = this.#heard;
    return () => visibleIf(this.#shown.has(entryId) || this.#heard === at);
  }

  /** How much the window wants the tile of `folderId` read: while it shows it. */
  tile(folderId: string): Want {
    return () => visibleIf(this.#tiles.has(folderId));
  }
}
