import type { PhotoLibrary } from '#photos/worker/library';
import { folderLocation } from '#photos/worker/location';
import { PrismTrashBatch, readManifest, restoreFromBatch } from '#photos/worker/prism-trash';
import {
  errorMessage,
  type PrismTrashView,
  type TrashPlan,
  type TrashProgress,
  type TrashUndoResult,
} from '@prism/shared';
import { restoreItem, trashItem } from '@prism/trash';
import { lstat, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';

/** Where a run's entries go: the system's Trash, or a batch of Prism's Trash. */
export interface TrashDestination {
  /** Moves `file` there; resolves with where it is now. */
  put: (file: string) => Promise<string>;
  /** The batch of Prism's Trash they go into, or `null` for the system's. */
  batch: string | null;
}

export const SYSTEM_TRASH: TrashDestination = { batch: null, put: trashItem };

/**
 * Where a run of `view` of the library at `root` goes: the system's Trash, or, as a network
 * share has none, a new batch of Prism's Trash at the top of the share, which remembers `view`.
 */
export async function trashDestinationFor(
  root: string,
  view?: PrismTrashView,
): Promise<TrashDestination> {
  if ((await folderLocation(root)) !== 'network') {
    return SYSTEM_TRASH;
  }
  try {
    const batch = await PrismTrashBatch.open(root, view && { view });
    return { batch: batch.dir, put: (file) => batch.put(file) };
  } catch (error) {
    throw new Error(`Prism can’t keep a Trash on this share: ${errorMessage(error)}`, {
      cause: error,
    });
  }
}

/** What a run moved, as Undo needs it: entries to the Trash, and entries out of folders. */
export interface TrashRun {
  /** By ID, with where the Trash put each. */
  trashed: { id: string; landed: string }[];
  /** By the IDs they had and have. */
  moved: { from: string; to: string }[];
  /** The batch of Prism's Trash the entries went into, or `null` for the system's Trash. */
  batch: string | null;
}

interface RunOutcome {
  run: TrashRun;
  skipped: number;
  error?: string;
}

/** Whether `error` says there is nothing at the path. */
function gone(error: unknown) {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

/**
 * Where `entryId` is on disk: its folder resolved inside the library, then the entry itself,
 * so a run never follows a link to move what it points at.
 */
async function located(library: PhotoLibrary, entryId: string) {
  const file = path.join(await library.resolve(path.dirname(entryId)), path.basename(entryId));
  await lstat(file);
  return file;
}

/** Whether nothing is at `file`. */
async function free(file: string) {
  try {
    await lstat(file);
    return false;
  } catch (error) {
    if (gone(error)) {
      return true;
    }
    throw error;
  }
}

/** `name` as one put back beside the entry that took its place: `photo (restored).jpg`, … */
export function restoredName(name: string, attempt: number) {
  const extension = path.extname(name);
  const stem = extension === name ? name : name.slice(0, name.length - extension.length);
  return `${stem} (restored${attempt > 1 ? ` ${attempt}` : ''})${extension}`;
}

/** Where to put `file` back: its own path, or a restored name beside it if that is taken. */
async function freePath(file: string) {
  for (let attempt = 0; ; attempt += 1) {
    const at =
      attempt === 0
        ? file
        : path.join(path.dirname(file), restoredName(path.basename(file), attempt));
    if (await free(at)) {
      return at;
    }
  }
}

/** The ID to put `entryId` back at: its own, or a restored name beside it if that is taken. */
async function freeId(library: PhotoLibrary, entryId: string) {
  const at = await freePath(path.join(library.root, entryId));
  return path.join(path.dirname(entryId), path.basename(at));
}

/** `file`'s ID in `library`, or `null` if it is outside it. */
function idIn(library: PhotoLibrary, file: string) {
  const id = path.relative(library.root, file);
  return id === '' || id.startsWith('..') || path.isAbsolute(id) ? null : id;
}

/**
 * Puts back everything the batch of Prism's Trash at `batch` holds where its manifest says it
 * came from, with Undo's restored names where a place was taken, and takes the batch away once
 * empty. Entries put back in `library` under a restored name take their kept ratings along.
 */
export async function putBackBatch(library: PhotoLibrary, batch: string): Promise<TrashUndoResult> {
  let restored = 0;
  const renamed: string[] = [];
  try {
    const { items } = await readManifest(batch);
    for (const { from, at } of items) {
      const target = await freePath(from);
      await mkdir(path.dirname(target), { recursive: true });
      await restoreFromBatch(batch, path.join(batch, at), target);
      restored += 1;
      if (target !== from) {
        renamed.push(path.basename(target));
        const was = idIn(library, from);
        const is = idIn(library, target);
        if (was !== null && is !== null) {
          await library.moveRatings(was, is).catch(() => null);
        }
      }
    }
  } catch (error) {
    return { error: `Couldn’t put everything back: ${errorMessage(error)}`, renamed, restored };
  }
  return { renamed, restored };
}

/**
 * Moves the entries a plan rescues out of their folders, then the entries it trashes to
 * `destination`, telling `onProgress` as each goes. Entries gone since the plan was made are
 * left out. A rescue that fails stops the run before anything goes, as the folder it was
 * rescued from would take it along; a failure to trash stops it where it is.
 */
export async function runTrashPlan(
  library: PhotoLibrary,
  plan: TrashPlan,
  destination: TrashDestination,
  onProgress: (progress: TrashProgress) => void,
): Promise<RunOutcome> {
  const run: TrashRun = { batch: destination.batch, moved: [], trashed: [] };
  let skipped = 0;
  for (const move of plan.moves) {
    const to = path.join(move.to, path.basename(move.id));
    try {
      const source = await located(library, move.id);
      const target = path.join(await library.resolve(move.to), path.basename(move.id));
      if (!(await free(target))) {
        throw new Error(
          `“${path.basename(move.id)}” is in ${move.to === '.' ? 'the top folder' : move.to} already.`,
        );
      }
      await rename(source, target);
    } catch (error) {
      if (gone(error)) {
        skipped += 1;
        continue;
      }
      return {
        error: `Couldn’t move “${path.basename(move.id)}” out: ${errorMessage(error)}`,
        run,
        skipped,
      };
    }
    await library.moveRatings(move.id, to).catch(() => null);
    run.moved.push({ from: move.id, to });
  }
  const total = plan.targets.length;
  for (const [done, entryId] of plan.targets.entries()) {
    try {
      run.trashed.push({
        id: entryId,
        landed: await destination.put(await located(library, entryId)),
      });
    } catch (error) {
      if (!gone(error)) {
        return {
          error: `Couldn’t move “${path.basename(entryId)}” to the Trash: ${errorMessage(error)}`,
          run,
          skipped,
        };
      }
      skipped += 1;
    }
    onProgress({ done: done + 1, total });
  }
  return { run, skipped };
}

/**
 * Puts back what `run` moved: what went to the Trash first, as entries moved out may go back
 * into folders among them, then those. An entry whose place was taken meanwhile comes back
 * beside it under a restored name, with its kept rating.
 */
export async function undoTrashRun(library: PhotoLibrary, run: TrashRun) {
  let restored = 0;
  const renamed: string[] = [];
  /** Puts an entry back at `entryId`, or beside it; resolves with the ID it came back at. */
  const back = async (entryId: string, put: (target: string) => Promise<void>) => {
    const id = await freeId(library, entryId);
    const target = path.join(library.root, id);
    await mkdir(path.dirname(target), { recursive: true });
    await put(target);
    if (id !== entryId) {
      renamed.push(path.basename(id));
    }
    restored += 1;
    return id;
  };
  try {
    for (const { id, landed } of run.trashed.toReversed()) {
      // Kept ratings stayed at its ID, so they move only if it comes back elsewhere.
      const at = await back(id, (target) =>
        run.batch ? restoreFromBatch(run.batch, landed, target) : restoreItem(landed, target),
      );
      if (at !== id) {
        await library.moveRatings(id, at).catch(() => null);
      }
    }
    for (const { from, to } of run.moved.toReversed()) {
      const source = await located(library, to);
      const at = await back(from, (target) => rename(source, target));
      await library.moveRatings(to, at).catch(() => null);
    }
  } catch (error) {
    return { error: `Couldn’t put everything back: ${errorMessage(error)}`, renamed, restored };
  }
  return { renamed, restored };
}
