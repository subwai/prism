import { isNotAllowed, isNotFound, isReadOnly } from '#photos/worker/disk/fs-errors';
import { MANIFEST, readManifest, saveManifest } from '#photos/worker/disk/trash/batch-manifest';
import { isIgnored, mediaKind, PRISM_TRASH } from '@prism/media';
import { errorMessage, type PrismTrashBatchInfo, type TrashCounts } from '@prism/shared';
import {
  access,
  constants,
  lstat,
  readdir,
  realpath,
  rename,
  rm,
  rmdir,
  stat,
} from 'node:fs/promises';
import path from 'node:path';

// `stat` reads what the disk records of a file: its size, its times and its number on the disk.
// `lstat` does the same as `stat`, but for a link itself rather than what it points to.
// `dev` is the number of the disk a file is on, which tells whether two paths are on one disk.

/**
 * The top of the volume `file` is on, where Prism keeps its Trash: the share of a UNC path
 * (Windows' way of naming a network share) on Windows, and elsewhere the highest folder above it on
 * the same device, its mount point.
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

/** Whether `dir` holds nothing but folders that hold nothing, at any depth, and `ignoring`. */
async function holdsOnlyEmptyFolders(dir: string, ignoring?: string): Promise<boolean> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === ignoring) {
      continue;
    }
    if (!entry.isDirectory() || !(await holdsOnlyEmptyFolders(path.join(dir, entry.name)))) {
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
  if (await holdsOnlyEmptyFolders(dir, MANIFEST)) {
    await rm(dir, { recursive: true });
    await rmdir(path.dirname(dir)).catch(() => null);
  }
}

/** Deletes the batch at `dir` for good, and the Trash too once it holds no batch. */
export async function deleteBatchForGood(dir: string): Promise<void> {
  await rm(dir, { force: true, recursive: true });
  await rmdir(path.dirname(dir)).catch(() => null);
}

/** Deletes Prism's Trash at `trash` for good, with every batch in it. */
export async function deletePrismTrash(trash: string): Promise<void> {
  await rm(trash, { force: true, recursive: true });
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

/** Prism's Trash at the top of the volume `library` is on, whether or not it exists. */
export async function prismTrashOf(library: string): Promise<{ top: string; trash: string }> {
  const top = await realpath(await volumeTopOf(library));
  return { top, trash: path.join(top, PRISM_TRASH) };
}

/**
 * Why Prism can't keep its Trash at `trash`, at the top of `top`, in a few words, or `null` if
 * it can: it must be able to write in the Trash, or make it.
 */
export async function whyNoPrismTrash({ top, trash }: { top: string; trash: string }) {
  try {
    await access(trash, constants.W_OK).catch(async (error: unknown) => {
      if (!isNotFound(error)) {
        throw error;
      }
      await access(top, constants.W_OK);
    });
    return null;
  } catch (error) {
    if (isReadOnly(error)) {
      return 'read-only';
    }
    if (isNotAllowed(error)) {
      return 'no permission to write at its top';
    }
    return errorMessage(error);
  }
}

/** The batches in Prism's Trash at `trash`, newest first; none if it doesn't exist. */
export async function listBatches(trash: string): Promise<PrismTrashBatchInfo[]> {
  let entries;
  try {
    entries = await readdir(trash, { withFileTypes: true });
  } catch (error) {
    if (isNotFound(error)) {
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
          entries: manifest?.items.length ?? 0,
          id: name,
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
