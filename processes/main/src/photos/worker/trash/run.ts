import { isNotFound } from '#photos/worker/disk/fs-errors';
import {
  deviceOf,
  isPathFree,
  moveOnDisk,
  requireEntryAt,
} from '#photos/worker/disk/trash/entry-moves';
import type { PhotoLibrary } from '#photos/worker/library/library';
import type { TrashDestination } from '#photos/worker/trash/destination';
import {
  errorMessage,
  type TrashLocation,
  type TrashMove,
  type TrashPlan,
  type TrashProgress,
} from '@prism/shared';
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

/**
 * What one step of a run did: the entries it moved, how many it skipped because they were gone,
 * and why it stopped, if it stopped early.
 */
interface StepOutcome<Moved> {
  done: Moved[];
  skipped: number;
  error?: string;
}

/**
 * Where `entryId` is on disk: its folder resolved inside the library, then the entry itself,
 * so a run never follows a link to move what it points at.
 */
export async function locateEntry(library: PhotoLibrary, entryId: string) {
  const file = path.join(await library.resolve(path.dirname(entryId)), path.basename(entryId));
  await requireEntryAt(file);
  return file;
}

/**
 * The first of `entryIds` on another volume than the library, such as a share mounted inside
 * it, or `null` if none is. Prism's Trash takes only what a rename can move into it, and
 * deleting for good must not reach a volume that may have a Trash of its own.
 */
async function findOnOtherVolume(library: PhotoLibrary, entryIds: string[]) {
  const dev = await deviceOf(library.root);
  for (const entryId of entryIds) {
    const entryDev = await locateEntry(library, entryId).then(deviceOf, () => null);
    if (entryDev !== null && entryDev !== dev) {
      return entryId;
    }
  }
  return null;
}

/** The start of the message a run stops with when `name` failed to go to `kind`. */
function failurePrefix(kind: TrashLocation['destination'], name: string) {
  return kind === 'delete' ? `Couldn’t delete “${name}”` : `Couldn’t move “${name}” to the Trash`;
}

/** Moves the rescued entry `move.id` out to `to`, inside the folder `move.to`. */
async function moveOutOfFolder(library: PhotoLibrary, move: TrashMove, to: string) {
  const source = await locateEntry(library, move.id);
  const target = path.join(await library.resolve(move.to), path.basename(move.id));
  if (!(await isPathFree(target))) {
    throw new Error(
      `“${path.basename(move.id)}” is in ${move.to === '.' ? 'the top folder' : move.to} already.`,
    );
  }
  // Its rows and kept ratings move with it, so nothing inside it is read again.
  await library.move(move.id, to, async () => {
    await moveOnDisk(source, target);
    return library.entryAt(to, move.to);
  });
}

/**
 * Moves the entries a plan rescues out of their folders, skipping those gone since the plan was
 * made. It stops at the first that fails.
 */
async function moveOutRescued(
  library: PhotoLibrary,
  moves: TrashMove[],
): Promise<StepOutcome<TrashRun['moved'][number]>> {
  const done: TrashRun['moved'] = [];
  let skipped = 0;
  for (const move of moves) {
    const to = path.join(move.to, path.basename(move.id));
    try {
      await moveOutOfFolder(library, move, to);
    } catch (error) {
      if (isNotFound(error)) {
        skipped += 1;
        continue;
      }
      return {
        done,
        error: `Couldn’t move “${path.basename(move.id)}” out: ${errorMessage(error)}`,
        skipped,
      };
    }
    done.push({ from: move.id, to });
  }
  return { done, skipped };
}

/** What `putTargets` puts where, and whom it tells how far it has got. */
interface TargetsToPut {
  targets: string[];
  destination: TrashDestination;
  onProgress: (progress: TrashProgress) => void;
}

/**
 * Puts each of `targets` in `destination`, calling `onProgress` as each goes, and skipping those
 * gone since the plan was made. It stops at the first that fails.
 */
async function putTargets(
  library: PhotoLibrary,
  { targets, destination, onProgress }: TargetsToPut,
): Promise<StepOutcome<TrashRun['trashed'][number]>> {
  const done: TrashRun['trashed'] = [];
  let skipped = 0;
  const total = targets.length;
  for (const [index, entryId] of targets.entries()) {
    try {
      done.push({
        id: entryId,
        landed: await destination.put(await locateEntry(library, entryId)),
      });
    } catch (error) {
      if (!isNotFound(error)) {
        return {
          done,
          error: `${failurePrefix(destination.kind, path.basename(entryId))}: ${errorMessage(error)}`,
          skipped,
        };
      }
      skipped += 1;
    }
    onProgress({ done: index + 1, total });
  }
  return { done, skipped };
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
  const { batch } = destination;
  const onOtherVolume =
    destination.kind === 'system' ? null : await findOnOtherVolume(library, plan.targets);
  if (onOtherVolume) {
    return {
      error: `“${path.basename(onOtherVolume)}” is on another disk than the folder, so nothing went.`,
      run: { batch, moved: [], trashed: [] },
      skipped: 0,
    };
  }
  const rescued = await moveOutRescued(library, plan.moves);
  if (rescued.error !== undefined) {
    return {
      error: rescued.error,
      run: { batch, moved: rescued.done, trashed: [] },
      skipped: rescued.skipped,
    };
  }
  const trashed = await putTargets(library, { destination, onProgress, targets: plan.targets });
  return {
    ...(trashed.error === undefined ? {} : { error: trashed.error }),
    run: { batch, moved: rescued.done, trashed: trashed.done },
    skipped: rescued.skipped + trashed.skipped,
  };
}
