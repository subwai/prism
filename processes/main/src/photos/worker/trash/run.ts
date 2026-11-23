import type { PhotoLibrary } from '#photos/worker/library';
import type { TrashDestination } from '#photos/worker/trash/destination';
import { readManifest, restoreFromBatch } from '#photos/worker/trash/prism-trash';
import {
  errorMessage,
  type TrashLocation,
  type TrashPlan,
  type TrashProgress,
  type TrashUndoSummary,
} from '@prism/shared';
import { restoreItem } from '@prism/trash';
import { lstat, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';

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
function isNotFound(error: unknown) {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

/**
 * Where `entryId` is on disk: its folder resolved inside the library, then the entry itself,
 * so a run never follows a link to move what it points at.
 */
async function locateEntry(library: PhotoLibrary, entryId: string) {
  const file = path.join(await library.resolve(path.dirname(entryId)), path.basename(entryId));
  await lstat(file);
  return file;
}

/**
 * The first of `entryIds` on another volume than the library, such as a share mounted inside
 * it, or `null` if none is. Prism's Trash takes only what a rename can move into it, and
 * deleting for good must not reach a volume that may have a Trash of its own.
 */
async function findOnOtherVolume(library: PhotoLibrary, entryIds: string[]) {
  const { dev } = await lstat(library.root);
  for (const entryId of entryIds) {
    const info = await locateEntry(library, entryId).then(lstat, () => null);
    if (info && info.dev !== dev) {
      return entryId;
    }
  }
  return null;
}

/** Whether nothing is at `file`. */
async function isPathFree(file: string) {
  try {
    await lstat(file);
    return false;
  } catch (error) {
    if (isNotFound(error)) {
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
async function findFreePath(file: string) {
  for (let attempt = 0; ; attempt += 1) {
    const at =
      attempt === 0
        ? file
        : path.join(path.dirname(file), restoredName(path.basename(file), attempt));
    if (await isPathFree(at)) {
      return at;
    }
  }
}

/** The ID to put `entryId` back at: its own, or a restored name beside it if that is taken. */
async function findFreeId(library: PhotoLibrary, entryId: string) {
  const at = await findFreePath(path.join(library.root, entryId));
  return path.join(path.dirname(entryId), path.basename(at));
}

/** `file`'s ID in `library`, or `null` if it is outside it. */
function entryIdIn(library: PhotoLibrary, file: string) {
  const id = path.relative(library.root, file);
  return id === '' || id.startsWith('..') || path.isAbsolute(id) ? null : id;
}

/**
 * Puts back everything the batch of Prism's Trash at `batch` holds where its manifest says it
 * came from, with Undo's restored names where a place was taken, and takes the batch onOtherVolume once
 * empty. Entries put back in `library` under a restored name take their kept ratings along.
 */
export async function putBackBatch(
  library: PhotoLibrary,
  batch: string,
): Promise<TrashUndoSummary> {
  let restored = 0;
  const renamed: string[] = [];
  try {
    const { items } = await readManifest(batch);
    for (const { from, at } of items) {
      const target = await findFreePath(from);
      await mkdir(path.dirname(target), { recursive: true });
      await restoreFromBatch(batch, path.join(batch, at), target);
      restored += 1;
      if (target !== from) {
        renamed.push(path.basename(target));
        const was = entryIdIn(library, from);
        const is = entryIdIn(library, target);
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

/** The start of the message a run stops with when `name` failed to go to `kind`. */
function failurePrefix(kind: TrashLocation['destination'], name: string) {
  return kind === 'delete' ? `Couldn’t delete “${name}”` : `Couldn’t move “${name}” to the Trash`;
}

/**
 * Moves the entries a plan rescues out of their folders, then the entries it trashes to
 * `destination`, calling `onProgress` as each goes. Entries gone since the plan was made are
 * left out. A rescue that fails stops the run before anything goes, as the folder it was
 * rescued from would take it along; a failure to trash stops it where it is. Nothing goes to
 * Prism's Trash or is deleted for good if any of it is on another volume than the library.
 */
export async function runTrashPlan(
  library: PhotoLibrary,
  plan: TrashPlan,
  destination: TrashDestination,
  onProgress: (progress: TrashProgress) => void,
): Promise<RunOutcome> {
  const run: TrashRun = { batch: destination.batch, moved: [], trashed: [] };
  let skipped = 0;
  const onOtherVolume =
    destination.kind === 'system' ? null : await findOnOtherVolume(library, plan.targets);
  if (onOtherVolume) {
    return {
      error: `“${path.basename(onOtherVolume)}” is on another disk than the folder, so nothing went.`,
      run,
      skipped,
    };
  }
  for (const move of plan.moves) {
    const to = path.join(move.to, path.basename(move.id));
    try {
      const source = await locateEntry(library, move.id);
      const target = path.join(await library.resolve(move.to), path.basename(move.id));
      if (!(await isPathFree(target))) {
        throw new Error(
          `“${path.basename(move.id)}” is in ${move.to === '.' ? 'the top folder' : move.to} already.`,
        );
      }
      // Its rows and kept ratings move with it, so nothing inside it is read again.
      await library.move(move.id, to, async () => {
        await rename(source, target);
        return library.entryAt(to, move.to);
      });
    } catch (error) {
      if (isNotFound(error)) {
        skipped += 1;
        continue;
      }
      return {
        error: `Couldn’t move “${path.basename(move.id)}” out: ${errorMessage(error)}`,
        run,
        skipped,
      };
    }
    run.moved.push({ from: move.id, to });
  }
  const total = plan.targets.length;
  for (const [done, entryId] of plan.targets.entries()) {
    try {
      run.trashed.push({
        id: entryId,
        landed: await destination.put(await locateEntry(library, entryId)),
      });
    } catch (error) {
      if (!isNotFound(error)) {
        return {
          error: `${failurePrefix(destination.kind, path.basename(entryId))}: ${errorMessage(error)}`,
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
  const putBack = async (entryId: string, put: (target: string) => Promise<void>) => {
    const id = await findFreeId(library, entryId);
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
      const at = await putBack(id, (target) =>
        run.batch ? restoreFromBatch(run.batch, landed, target) : restoreItem(landed, target),
      );
      if (at !== id) {
        await library.moveRatings(id, at).catch(() => null);
      }
    }
    for (const { from, to } of run.moved.toReversed()) {
      const source = await locateEntry(library, to);
      await putBack(from, async (target) => {
        const at = path.relative(library.root, target);
        await library.move(to, at, async () => {
          await rename(source, target);
          return library.entryAt(at, path.dirname(at));
        });
      });
    }
  } catch (error) {
    return { error: `Couldn’t put everything back: ${errorMessage(error)}`, renamed, restored };
  }
  return { renamed, restored };
}
