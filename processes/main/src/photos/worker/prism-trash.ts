import { PRISM_TRASH } from '@prism/media';
import {
  lstat,
  mkdir,
  readdir,
  realpath,
  rename,
  rm,
  rmdir,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';

/** What a batch of Prism's Trash records of what it holds, beside it in `manifest.json`. */
export interface PrismTrashManifest {
  version: 1;
  /** When the run that filled it began. */
  trashedAt: string;
  /** The folder Prism had open, whose view the run was of. */
  library: string;
  /** Each item, by where it was and where it is in the batch, relative to the batch. */
  items: { from: string; at: string }[];
}

const MANIFEST = 'manifest.json';

/**
 * The top of the volume `file` is on, where Prism keeps its Trash: the share of a UNC path on
 * Windows, and elsewhere the highest folder above it on the same device, its mount point.
 */
export async function volumeTopOf(file: string): Promise<string> {
  if (process.platform === 'win32') {
    return path.parse(file).root;
  }
  const { dev } = await stat(file);
  let top = path.dirname(file);
  for (let dir = path.dirname(top); dir !== top; dir = path.dirname(dir)) {
    const info = await stat(dir).catch(() => null);
    if (info?.dev !== dev) {
      break;
    }
    top = dir;
  }
  return top;
}

/** A batch's name: when its run began, sortable, and safe on every filesystem. */
export function batchName(date: Date): string {
  return `${date.toISOString().slice(0, 19).replaceAll(':', '-')}Z`;
}

/**
 * A batch of Prism's Trash for one run, which items move into by renames on their own volume:
 * instant, even for thousands, as a share with no Trash of its own needs. Each keeps its path
 * from the top of the volume, and the manifest records where it came from.
 */
export class PrismTrashBatch {
  private readonly items: PrismTrashManifest['items'] = [];

  private constructor(
    readonly dir: string,
    private readonly top: string,
    private readonly manifest: Omit<PrismTrashManifest, 'items'>,
  ) {}

  /**
   * A new batch in the Trash at the top of the volume `library` is on, or of `top`, for a run
   * begun at `date`.
   */
  static async open(
    library: string,
    { date = new Date(), top }: { date?: Date; top?: string } = {},
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
    return new PrismTrashBatch(dir, root, {
      library,
      trashedAt: date.toISOString(),
      version: 1,
    });
  }

  /** Moves `file` into the batch; resolves with where it is there. */
  async put(file: string): Promise<string> {
    // By its folder's real path, as the top's is, but not following the item if it is a link.
    const real = path.join(await realpath(path.dirname(file)), path.basename(file));
    const at = path.relative(this.top, real);
    const landed = path.join(this.dir, at);
    await mkdir(path.dirname(landed), { recursive: true });
    await rename(real, landed);
    this.items.push({ at, from: real });
    await this.save();
    return landed;
  }

  /** Writes the manifest, after each item, so a run that stops partway still says what it moved. */
  private async save() {
    const manifest: PrismTrashManifest = { ...this.manifest, items: this.items };
    await writeFile(path.join(this.dir, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
  }

  /** Takes the batch away if it is empty: nothing went, or everything came back. */
  async dropIfEmpty() {
    await dropEmptyBatch(this.dir);
  }
}

/** Whether `dir` holds nothing but folders that hold nothing, at any depth, and `ignoring`. */
async function holdsNothing(dir: string, ignoring?: string): Promise<boolean> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === ignoring) {
      continue;
    }
    if (!entry.isDirectory() || !(await holdsNothing(path.join(dir, entry.name)))) {
      return false;
    }
  }
  return true;
}

/**
 * Takes away the batch at `dir` once nothing is left in it but its manifest and empty folders,
 * and the Trash too once it holds no batch. A batch that still holds anything keeps its
 * manifest, which says where everything came from.
 */
export async function dropEmptyBatch(dir: string) {
  if (await holdsNothing(dir, MANIFEST)) {
    await rm(dir, { recursive: true });
    await rmdir(path.dirname(dir)).catch(() => null);
  }
}

/** Moves an item back out of a batch, and takes the batch away once it is empty. */
export async function restoreFromBatch(batch: string, landed: string, to: string) {
  await rename(landed, to);
  await dropEmptyBatch(batch);
}
