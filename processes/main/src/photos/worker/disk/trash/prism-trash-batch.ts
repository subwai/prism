import { type PrismTrashManifest, saveManifest } from '#photos/worker/disk/trash/batch-manifest';
import { batchName, dropEmptyBatch, volumeTopOf } from '#photos/worker/disk/trash/prism-trash';
import { PRISM_TRASH } from '@prism/media';
import type { TrashedView } from '@prism/shared';
import { lstat, mkdir, realpath, rename } from 'node:fs/promises';
import path from 'node:path';

// The manifest is saved after this many items, or once this long has passed since the last save,
// whichever comes first, and at the end of the run. Saving after each item rewrote the whole
// growing list every time: a run of 10k items wrote it 10k times, the last ones about 1 MB each,
// to the share.
const SAVE_EVERY_ITEMS = 100;
const SAVE_EVERY_MS = 1000;

/**
 * A batch of Prism's Trash for one run, which items move into by renames on their own volume:
 * instant, even for thousands, as a share with no Trash of its own needs. Each keeps its path
 * from the top of the volume, and the manifest records where it came from. Items moved since its
 * last save are still found by their place in the batch; see `itemsOf` in `batch-manifest.ts`.
 */
export class PrismTrashBatch {
  private readonly items: PrismTrashManifest['items'] = [];
  /** The folders made in the batch this run, so each is made once. */
  private readonly madeFolders = new Set<string>();
  private savedCount = 0;
  /** Whether each item is saved as it moves, from when the app began to quit. */
  private savesEachItem = false;
  private savedAtMs: number;

  private constructor(
    readonly dir: string,
    private readonly top: string,
    private readonly manifest: Omit<PrismTrashManifest, 'items'>,
    private readonly now: () => number,
  ) {
    this.savedAtMs = now();
  }

  /**
   * A new batch in the Trash at the top of the volume `library` is on, or of `top`, for a run
   * begun at `date` of `view`, whose folder is a path on that volume. `now` tells the time for
   * when to save the manifest.
   */
  static async open(
    library: string,
    {
      date = new Date(),
      now = Date.now,
      top,
      view,
    }: { date?: Date; now?: () => number; top?: string; view?: TrashedView } = {},
  ): Promise<PrismTrashBatch> {
    // Real paths, as the library's are, so items keep their place under the top.
    const root = await realpath(top ?? (await volumeTopOf(library)));
    let dir = path.join(root, PRISM_TRASH, batchName(date));
    // Runs a second apart get batches of their own.
    for (
      let attempt = 2;
      await lstat(dir).then(
        () => true,
        () => false,
      );
      attempt += 1
    ) {
      dir = path.join(root, PRISM_TRASH, `${batchName(date)}-${attempt}`);
    }
    await mkdir(dir, { recursive: true });
    const manifest = {
      library,
      trashedAt: date.toISOString(),
      version: 1 as const,
      ...(view && {
        view: { ...view, folder: path.relative(root, await realpath(view.folder)) },
      }),
    };
    return new PrismTrashBatch(dir, root, manifest, now);
  }

  /**
   * Moves `file` into the batch; resolves with where it is there. Its folder must be given by
   * its real path, as the top's is and as `locateEntry` finds it, so it keeps its place under
   * the top. The item itself is not followed if it is a link.
   */
  async put(file: string): Promise<string> {
    const at = path.relative(this.top, file);
    const landed = path.join(this.dir, at);
    await this.makeFolder(path.dirname(landed));
    await rename(file, landed);
    this.items.push({ at, from: file });
    if (
      this.savesEachItem ||
      this.items.length - this.savedCount >= SAVE_EVERY_ITEMS ||
      this.isSaveDue()
    ) {
      await this.save();
    }
    return landed;
  }

  /**
   * Saves what the manifest does not have yet, and from then on each item as it moves: as the run
   * ends, however it ends, and as the app quits, so all the worker moved before it stops is in
   * the manifest.
   */
  async keepSaved(): Promise<void> {
    this.savesEachItem = true;
    if (this.items.length > this.savedCount) {
      await this.save();
    }
  }

  /** Makes `folder` in the batch, unless this run made it already. */
  private async makeFolder(folder: string) {
    if (!this.madeFolders.has(folder)) {
      await mkdir(folder, { recursive: true });
      this.madeFolders.add(folder);
    }
  }

  private isSaveDue() {
    return this.now() - this.savedAtMs >= SAVE_EVERY_MS;
  }

  private async save() {
    const count = this.items.length;
    await saveManifest(this.dir, { ...this.manifest, items: this.items.slice(0, count) });
    this.savedCount = count;
    this.savedAtMs = this.now();
  }

  /** Takes the batch away if it is empty: nothing went, or everything came back. */
  async dropIfEmpty() {
    await dropEmptyBatch(this.dir);
  }
}
