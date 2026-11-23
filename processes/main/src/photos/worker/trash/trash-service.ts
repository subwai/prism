import { requireString } from '#photos/validate';
import { folderLocation } from '#photos/worker/disk/share/folder-location';
import {
  batchContents,
  deleteBatchForGood,
  deletePrismTrash,
  dropEmptyBatch,
  listBatches,
  prismTrashOf,
  whyNoPrismTrash,
} from '#photos/worker/disk/trash/prism-trash';
import type { PhotoLibrary } from '#photos/worker/library/library';
import { deleteForGood, trashDestinationFor } from '#photos/worker/trash/destination';
import { runTrashPlan, type TrashRun } from '#photos/worker/trash/run';
import { putBackBatch, undoTrashRun } from '#photos/worker/trash/undo';
import type {
  PrismTrash,
  TrashChoices,
  TrashCounts,
  TrashDestination,
  TrashLocation,
  TrashProgress,
  TrashRunSummary,
  TrashUndoSummary,
} from '@prism/shared';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

// Runs Undo can still put back; the window offers it only for the last.
const KEPT_RUNS = 8;

/** The name of the share whose top is `top`, as the window shows it. */
function shareName(top: string) {
  return path.basename(top) || top;
}

/**
 * What a folder's worker does with the Trash: runs views' plans to it, or deletes them for good
 * where there is none, undoes them, and keeps Prism's Trash on a share, whose batches can be put
 * back or deleted for good. `onProgress` is called as a run goes.
 */
export function trashService(
  library: PhotoLibrary,
  onProgress?: (progress: TrashProgress) => void,
) {
  const runs = new Map<string, TrashRun>();

  /** Prism's Trash on the library's share, or `null` if the library is not on a share. */
  async function findPrismTrash() {
    if ((await folderLocation(library.root)) !== 'network') {
      return null;
    }
    return prismTrashOf(library.root);
  }

  /** Where runs go: the system's Trash, Prism's on a share, or, if it can't keep one, nowhere. */
  async function getTrashLocation(): Promise<TrashLocation> {
    const trash = await findPrismTrash();
    if (!trash) {
      return { destination: 'system' };
    }
    const share = shareName(trash.top);
    const blocked = await whyNoPrismTrash(trash);
    return blocked ? { blocked, destination: 'delete', share } : { destination: 'prism', share };
  }

  /** The folder of the batch `batchId` of Prism's Trash, which must be one of its own. */
  async function batchFolder(batchId: string) {
    requireString(batchId);
    const trash = await findPrismTrash();
    if (!trash || batchId !== path.basename(batchId) || batchId.startsWith('.')) {
      throw new Error('That isn’t in Prism’s Trash.');
    }
    return path.join(trash.trash, batchId);
  }

  /**
   * Where a run of the view `viewId` goes, as the person chose `to`: deleted for good, or the
   * Trash, which on a share is a new batch of Prism's Trash that remembers the view.
   */
  async function destinationOf(viewId: string, to: TrashDestination) {
    const spec = library.views.specOf(viewId);
    if (to === 'delete') {
      return deleteForGood(library.root);
    }
    return trashDestinationFor(library.root, {
      filter: spec.filter,
      folder: await library.resolve(spec.directoryId),
      search: spec.search,
    });
  }

  /** Keeps `run` for Undo, with the last few before it, and returns its ID. */
  function keepForUndo(run: TrashRun): string {
    const runId = randomUUID();
    runs.set(runId, run);
    for (const old of [...runs.keys()].slice(0, -KEPT_RUNS)) {
      runs.delete(old);
    }
    return runId;
  }

  /** Forgets the runs into the batches `gone` takes away, which Undo can no longer put back. */
  function forgetRuns(gone: (batch: string) => boolean) {
    for (const [runId, run] of runs) {
      if (run.batch && gone(run.batch)) {
        runs.delete(runId);
      }
    }
  }

  return {
    async deleteTrashBatch(batchId: string): Promise<void> {
      const batch = await batchFolder(batchId);
      forgetRuns((dir) => dir === batch);
      await deleteBatchForGood(batch);
    },

    async emptyPrismTrash(): Promise<void> {
      const trash = await findPrismTrash();
      if (trash) {
        forgetRuns((dir) => path.dirname(dir) === trash.trash);
        await deletePrismTrash(trash.trash);
      }
    },

    getTrashLocation,

    async prismTrash(): Promise<PrismTrash | null> {
      const trash = await findPrismTrash();
      if (!trash) {
        return null;
      }
      return {
        batches: await listBatches(trash.trash),
        share: shareName(trash.top),
      };
    },

    async prismTrashContents(batchId: string): Promise<TrashCounts> {
      return batchContents(await batchFolder(batchId));
    },

    async putBackTrashBatch(batchId: string): Promise<TrashUndoSummary> {
      const batch = await batchFolder(batchId);
      forgetRuns((dir) => dir === batch);
      return putBackBatch(library, batch);
    },

    async trashView(
      viewId: string,
      version: number,
      choices: TrashChoices,
      to: TrashDestination,
    ): Promise<TrashRunSummary> {
      requireString(to);
      const plan = await library.trashPlans.plan(viewId, version, choices);
      if (!plan) {
        throw new Error('The folder changed since this was planned. Review it again.');
      }
      // Only where the person was told, never deleting for good unasked.
      if ((await getTrashLocation()).destination !== to) {
        throw new Error('Where these go changed since this was planned. Review it again.');
      }
      const destination = await destinationOf(viewId, to);
      const { error, run, skipped } = await runTrashPlan(library, plan, destination, (progress) =>
        onProgress?.(progress),
      );
      if (run.batch && run.trashed.length === 0) {
        await dropEmptyBatch(run.batch).catch(() => null);
      }
      // What was deleted can't come back, so neither does what was moved out of its way.
      const canUndo = to !== 'delete' && (run.trashed.length > 0 || run.moved.length > 0);
      const runId = canUndo ? keepForUndo(run) : null;
      return {
        destination: destination.kind,
        moved: run.moved.length,
        runId,
        skipped,
        trashed: run.trashed.length,
        ...(error === undefined ? {} : { error }),
      };
    },

    undoTrash(runId: string): Promise<TrashUndoSummary> {
      requireString(runId);
      const run = runs.get(runId);
      if (!run) {
        return Promise.reject(new Error('That can no longer be undone.'));
      }
      runs.delete(runId);
      return undoTrashRun(library, run);
    },
  };
}

export type TrashService = ReturnType<typeof trashService>;
