import { isPathFree, makeParentFolders, moveOnDisk } from '#photos/worker/disk/trash/entry-moves';
import { readManifest, restoreFromBatch } from '#photos/worker/disk/trash/prism-trash';
import { putBackFromSystemTrash } from '#photos/worker/disk/trash/system-trash';
import type { PhotoLibrary } from '#photos/worker/library/library';
import { locateEntry, type TrashRun } from '#photos/worker/trash/run';
import { errorMessage, type TrashUndoSummary } from '@prism/shared';
import path from 'node:path';

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
 * came from, with Undo's restored names where a place was taken, and takes the batch away once
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
      await makeParentFolders(target);
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
    await makeParentFolders(target);
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
        run.batch
          ? restoreFromBatch(run.batch, landed, target)
          : putBackFromSystemTrash(landed, target),
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
          await moveOnDisk(source, target);
          return library.entryAt(at, path.dirname(at));
        });
      });
    }
  } catch (error) {
    return { error: `Couldn’t put everything back: ${errorMessage(error)}`, renamed, restored };
  }
  return { renamed, restored };
}
