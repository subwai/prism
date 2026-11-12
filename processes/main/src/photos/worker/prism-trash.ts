import { isIgnored, mediaKind, PRISM_TRASH } from '@prism/media';
import type { PrismTrashBatchInfo, PrismTrashView, TrashCounts } from '@prism/shared';
import {
  lstat,
  mkdir,
  readdir,
  readFile,
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
  /** What the run was of; batches made before Prism remembered it lack it. */
  view?: PrismTrashView;
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
  // From `file` itself, which is the top when it is a folder a share is mounted at.
  let top = file;
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
   * begun at `date` of `view`, whose folder is a path on that volume.
   */
  static async open(
    library: string,
    { date = new Date(), top, view }: { date?: Date; top?: string; view?: PrismTrashView } = {},
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
      ...(view && {
        view: { ...view, folder: path.relative(root, await realpath(view.folder)) },
      }),
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
    await saveManifest(this.dir, { ...this.manifest, items: this.items });
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

/**
 * Moves an item back out of a batch, which then no longer lists it, and takes the batch away
 * once it is empty.
 */
export async function restoreFromBatch(batch: string, landed: string, to: string) {
  await rename(landed, to);
  const manifest = await readManifest(batch).catch(() => null);
  if (manifest) {
    const at = path.relative(batch, landed);
    await saveManifest(batch, {
      ...manifest,
      items: manifest.items.filter((item) => item.at !== at),
    });
  }
  await dropEmptyBatch(batch);
}

/** What the batch at `dir` holds and where it came from. */
export async function readManifest(dir: string): Promise<PrismTrashManifest> {
  return JSON.parse(await readFile(path.join(dir, MANIFEST), 'utf8')) as PrismTrashManifest;
}

async function saveManifest(dir: string, manifest: PrismTrashManifest) {
  await writeFile(path.join(dir, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
}

/** Prism's Trash at the top of the volume `library` is on, whether or not it exists. */
export async function prismTrashOf(library: string): Promise<{ top: string; trash: string }> {
  const top = await realpath(await volumeTopOf(library));
  return { top, trash: path.join(top, PRISM_TRASH) };
}

/** The batches in Prism's Trash at `trash`, newest first; none if it doesn't exist. */
export async function listBatches(trash: string): Promise<PrismTrashBatchInfo[]> {
  let entries;
  try {
    entries = await readdir(trash, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
  const batches = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async ({ name }) => {
        const manifest = await readManifest(path.join(trash, name)).catch(() => null);
        const batch: PrismTrashBatchInfo = {
          id: name,
          items: manifest?.items.length ?? 0,
          trashedAt: manifest?.trashedAt ?? null,
        };
        if (manifest?.view) {
          batch.view = manifest.view;
        }
        return batch;
      }),
  );
  // Names sort by when their runs began.
  return batches.toSorted((first, second) => second.id.localeCompare(first.id));
}

/** What the batch at `dir` holds at every depth, but its manifest and the system's clutter. */
export async function batchContents(dir: string): Promise<TrashCounts> {
  const counts: TrashCounts = { files: 0, folders: 0, photos: 0, size: 0, videos: 0 };
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  await Promise.all(
    entries
      .filter(
        ({ name, parentPath }) => !isIgnored(name) && !(parentPath === dir && name === MANIFEST),
      )
      .map(async (entry) => {
        if (entry.isDirectory()) {
          counts.folders += 1;
          return;
        }
        const kind = mediaKind(entry.name);
        if (kind === 'image') {
          counts.photos += 1;
        } else if (kind === 'video') {
          counts.videos += 1;
        } else {
          counts.files += 1;
        }
        // Read first: `+=` across an await would add to the total as it was before.
        const { size } = await lstat(path.join(entry.parentPath, entry.name));
        counts.size += size;
      }),
  );
  return counts;
}
