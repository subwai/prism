import { DelayedCall, type PhotosAPI, type ScreenContents } from '@prism/shared';

// What is on screen is sent this long after it first changes, so a screenful of tiles coming
// into view, or the frames of a scroll, go in one message.
const SEND_DELAY_MS = 50;

/**
 * Adds one to `id`'s count in `counts`, as one more thing on screen shows it. Returns the
 * function to call once that thing goes. `changed` is called when `id` first appears, and again
 * once nothing shows it any more.
 */
function countShown(counts: Map<string, number>, id: string, changed: () => void) {
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
 * Reports what the window has on screen to the library worker. The worker's scheduler orders
 * every read of the disk by it. It reports:
 * - the entries whose thumbnails or originals are on screen;
 * - the folders on screen whose tiles may still change, so the worker reads them;
 * - the rows each gallery shows of its view.
 *
 * It does no work of its own. The worker makes what is on screen, and drops what nothing on
 * screen needs any more.
 */
export class ScreenContentsReporter {
  readonly #entries = new Map<string, number>();
  readonly #foldersToRead = new Map<string, number>();
  readonly #views = new Map<string, { start: number; end: number }>();
  readonly #sendSoon = new DelayedCall(() => this.#send(), SEND_DELAY_MS);
  /** What was sent last, so a change that comes back to it sends nothing. */
  #sent = '';

  constructor(private readonly api: PhotosAPI) {}

  /** Marks an entry as on screen. Returns the function to call once it is not. */
  markEntryOnScreen(entryId: string): () => void {
    return countShown(this.#entries, entryId, () => this.#sendSoon.request());
  }

  isEntryOnScreen(entryId: string): boolean {
    return this.#entries.has(entryId);
  }

  /**
   * Marks a folder whose tile is on screen and may still change, so the worker reads it. Returns
   * the function to call once it is not on screen.
   */
  markFolderToRead(folderId: string): () => void {
    return countShown(this.#foldersToRead, folderId, () => this.#sendSoon.request());
  }

  /** Says a gallery shows the rows of its view from `start` up to `end`. */
  showRows(viewId: string, start: number, end: number): void {
    const was = this.#views.get(viewId);
    if (was?.start !== start || was.end !== end) {
      this.#views.set(viewId, { end, start });
      this.#sendSoon.request();
    }
  }

  /** Says a gallery no longer shows its view. */
  hideRows(viewId: string): void {
    if (this.#views.delete(viewId)) {
      this.#sendSoon.request();
    }
  }

  #send() {
    const contents: ScreenContents = {
      foldersToRead: [...this.#foldersToRead.keys()],
      shown: [...this.#entries.keys()],
      views: [...this.#views].map(([viewId, { start, end }]) => ({ end, start, viewId })),
    };
    const sent = JSON.stringify(contents);
    if (sent !== this.#sent) {
      this.#sent = sent;
      // There is no answer. What it changes arrives later, as thumbnails and rows.
      this.api.reportScreenContents(contents).catch(() => null);
    }
  }

  close(): void {
    this.#sendSoon.cancel();
  }
}
