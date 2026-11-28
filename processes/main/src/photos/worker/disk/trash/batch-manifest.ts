import { isNotFound } from '#photos/worker/disk/fs-errors';
import { isIgnored } from '@prism/media';
import type { TrashedView } from '@prism/shared';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** The name of the file beside a batch's items that records them. */
export const MANIFEST = 'manifest.json';

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
  view?: TrashedView;
}

/** What the batch at `dir` holds and where it came from. */
export async function readManifest(dir: string): Promise<PrismTrashManifest> {
  return JSON.parse(await readFile(path.join(dir, MANIFEST), 'utf8')) as PrismTrashManifest;
}

/** Whether `at` is `item` or inside it, both paths in a batch. */
function isWithinItem(item: string, at: string) {
  return at === item || at.startsWith(`${item}${path.sep}`);
}

/**
 * Of the files a batch holds, those its manifest does not list as items or inside one, as a run
 * that stopped between saves leaves them. Folders are left out: one emptied by an earlier Undo
 * must not come back, and a folder moved in whole comes back by its files.
 */
export function unlistedFiles(files: string[], listed: string[]): string[] {
  return files.filter((at) => !listed.some((item) => isWithinItem(item, at)));
}

/**
 * The items of the batch at `dir`, with where each came from: those its manifest lists, then
 * files it does not, found by their place in the batch, which mirrors where they were under the
 * top of the volume. A run saves its manifest only now and then, so one that stopped between
 * saves, as when the app was quit, leaves such files.
 */
export async function itemsOf(dir: string): Promise<PrismTrashManifest['items']> {
  const manifest = await readManifest(dir).catch((error: unknown) => {
    if (isNotFound(error)) {
      return null;
    }
    throw error;
  });
  const listed = manifest?.items ?? [];
  const files = (await readdir(dir, { recursive: true, withFileTypes: true }))
    .filter((entry) => !entry.isDirectory())
    .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)))
    .filter((at) => at !== MANIFEST && !isIgnored(path.basename(at)));
  // A batch is in the Trash folder at the top of its volume.
  const top = path.dirname(path.dirname(dir));
  const unlisted = unlistedFiles(
    files,
    listed.map(({ at }) => at),
  ).map((at) => ({ at, from: path.join(top, at) }));
  return [...listed, ...unlisted];
}

export async function saveManifest(dir: string, manifest: PrismTrashManifest) {
  await writeFile(path.join(dir, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
}
