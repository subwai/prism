import type { Attention, PhotosAPI } from '@prism/shared';

// What the window shows is sent this long after it first changes, so a screenful of tiles coming
// into view, or a scroll's frames, are one message.
const SEND_MS = 50;

/** Counts `id` once more in `counts`; returns what to call once it is no longer on show. */
function count(counts: Map<string, number>, id: string, changed: () => void) {
  counts.set(id, (counts.get(id) ?? 0) + 1);
  if (counts.get(id) === 1) {
    changed();
  }
  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    const left = (counts.get(id) ?? 1) - 1;
    if (left === 0) {
      counts.delete(id);
      changed();
    } else {
      counts.set(id, left);
    }
  };
}

/**
 * What the window has on show, which it tells the folder's worker, whose scheduler orders every
 * read of the disk by it: the entries whose thumbnails or originals are on show, the folders on
 * show whose tiles may not say all they will, and the rows each gallery shows of its view. It
 * keeps no work of its own; the worker answers what it asked for, and drops what nothing on show
 * wants any more.
 */
export class WindowAttention {
  readonly #shown = new Map<string, number>();
  readonly #tiles = new Map<string, number>();
  readonly #views = new Map<string, { start: number; end: number }>();
  #timer: ReturnType<typeof setTimeout> | undefined;
  /** What was sent last, so a change that comes back to it sends nothing. */
  #sent = '';

  constructor(private readonly api: PhotosAPI) {}

  /** Marks an entry as on show; returns what to call once it is not. */
  show(entryId: string): () => void {
    return count(this.#shown, entryId, () => this.#changed());
  }

  /** Whether an entry is on show. */
  has(entryId: string): boolean {
    return this.#shown.has(entryId);
  }

  /** Marks a folder's tile as on show and unsettled; returns what to call once it is not. */
  showTile(folderId: string): () => void {
    return count(this.#tiles, folderId, () => this.#changed());
  }

  /** Says a gallery shows the rows of its view from `start` up to `end`. */
  showRows(viewId: string, start: number, end: number): void {
    const was = this.#views.get(viewId);
    if (was?.start !== start || was.end !== end) {
      this.#views.set(viewId, { end, start });
      this.#changed();
    }
  }

  /** Says a gallery no longer shows its view. */
  hideRows(viewId: string): void {
    if (this.#views.delete(viewId)) {
      this.#changed();
    }
  }

  #changed() {
    this.#timer ??= setTimeout(() => {
      this.#timer = undefined;
      this.#send();
    }, SEND_MS);
  }

  #send() {
    const attention: Attention = {
      shown: [...this.#shown.keys()],
      tiles: [...this.#tiles.keys()],
      views: [...this.#views].map(([viewId, { start, end }]) => ({ end, start, viewId })),
    };
    const sent = JSON.stringify(attention);
    if (sent !== this.#sent) {
      this.#sent = sent;
      // Nothing is answered; what it changes arrives as thumbnails and rows do.
      this.api.attend(attention).catch(() => null);
    }
  }

  close(): void {
    clearTimeout(this.#timer);
    this.#timer = undefined;
  }
}
