import { requireString } from '#photos/validate';
import type { PhotoLibrary } from '#photos/worker/library';
import { folderLocation } from '#photos/worker/location';
import {
  batchContents,
  dropEmptyBatch,
  listBatches,
  prismTrashOf,
} from '#photos/worker/prism-trash';
import {
  putBackBatch,
  runTrashPlan,
  trashDestinationFor,
  type TrashRun,
  undoTrashRun,
} from '#photos/worker/trash-run';
import type {
  PrismTrash,
  TrashChoices,
  TrashCounts,
  TrashProgress,
  TrashRunResult,
  TrashUndoResult,
} from '@prism/shared';
import { randomUUID } from 'node:crypto';
import { rm, rmdir } from 'node:fs/promises';
import path from 'node:path';

// Runs Undo can still put back; the window offers it only for the last.
const KEPT_RUNS = 8;

/**
 * What a folder's worker does with the Trash: runs views' plans to it, undoes them, and keeps
 * Prism's Trash on a share, whose batches can be put back or deleted for good. `trashing` hears
 * how far a run has got.
 */
export function trashService(library: PhotoLibrary, trashing?: (progress: TrashProgress) => void) {
  const runs = new Map<string, TrashRun>();

  /** Prism's Trash on the library's share, or `null` if the library is not on a share. */
  async function sharesTrash() {
    if ((await folderLocation(library.root)) !== 'network') {
      return null;
    }
    return prismTrashOf(library.root);
  }

  /** The folder of the batch `batchId` of Prism's Trash, which must be one of its own. */
  async function batchOf(batchId: string) {
    requireString(batchId);
    const trash = await sharesTrash();
    if (!trash || batchId !== path.basename(batchId) || batchId.startsWith('.')) {
      throw new Error('That isn’t in Prism’s Trash.');
    }
    return path.join(trash.trash, batchId);
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
      const batch = await batchOf(batchId);
      forgetRuns((dir) => dir === batch);
      await rm(batch, { force: true, recursive: true });
      await rmdir(path.dirname(batch)).catch(() => null);
    },

    async emptyPrismTrash(): Promise<void> {
      const trash = await sharesTrash();
      if (trash) {
        forgetRuns((dir) => path.dirname(dir) === trash.trash);
        await rm(trash.trash, { force: true, recursive: true });
      }
    },

    async prismTrash(): Promise<PrismTrash | null> {
      const trash = await sharesTrash();
      if (!trash) {
        return null;
      }
      return {
        batches: await listBatches(trash.trash),
        share: path.basename(trash.top) || trash.top,
      };
    },

    async prismTrashContents(batchId: string): Promise<TrashCounts> {
      return batchContents(await batchOf(batchId));
    },

    async putBackTrashBatch(batchId: string): Promise<TrashUndoResult> {
      const batch = await batchOf(batchId);
      forgetRuns((dir) => dir === batch);
      return putBackBatch(library, batch);
    },

    async trashView(
      viewId: string,
      version: number,
      choices: TrashChoices,
    ): Promise<TrashRunResult> {
      const plan = await library.trashPlan(viewId, version, choices);
      if (!plan) {
        throw new Error('The folder changed since this was planned. Review it again.');
      }
      const spec = library.views.specOf(viewId);
      const destination = await trashDestinationFor(library.root, {
        filter: spec.filter,
        folder: await library.resolve(spec.directoryId),
        search: spec.search,
      });
      const { error, run, skipped } = await runTrashPlan(library, plan, destination, (progress) =>
        trashing?.(progress),
      );
      if (run.batch && run.trashed.length === 0) {
        await dropEmptyBatch(run.batch).catch(() => null);
      }
      let runId: string | null = null;
      if (run.trashed.length > 0 || run.moved.length > 0) {
        runId = randomUUID();
        runs.set(runId, run);
        for (const old of [...runs.keys()].slice(0, -KEPT_RUNS)) {
          runs.delete(old);
        }
      }
      return {
        destination: run.batch ? 'prism' : 'system',
        moved: run.moved.length,
        runId,
        skipped,
        trashed: run.trashed.length,
        ...(error === undefined ? {} : { error }),
      };
    },

    undoTrash(runId: string): Promise<TrashUndoResult> {
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
