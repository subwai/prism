import type { LibrarySession } from '#data/library';
import { narrowedBy } from '#data/trash';
import type { PrismTrashBatchInfo, UndoTrashResult } from '@prism/shared';
import { queryOptions } from '@tanstack/react-query';

/** Prism's Trash on the folder's share, or `null` off a share, which runs into it change. */
export function prismTrashQuery(library: LibrarySession) {
  return queryOptions({
    queryFn: () => library.trash.prismTrash(),
    queryKey: ['prism-trash'],
  });
}

/** What a batch of Prism's Trash holds, at every depth. */
export function batchContentsQuery(library: LibrarySession, batchId: string) {
  return queryOptions({
    queryFn: () => library.trash.prismTrashContents(batchId),
    queryKey: ['prism-trash', batchId],
  });
}

/**
 * Reads Prism's Trash again, after anything that moves entries into or out of it: the watcher
 * ignores it, so nothing else would.
 */
export async function prismTrashChanged(library: LibrarySession) {
  await library.queries.invalidateQueries({ queryKey: ['prism-trash'] });
}

/** What an action on Prism's Trash did, for the toast that says so. */
export type PrismTrashActionResult =
  | { intent: 'put-back-trash-batch'; result: UndoTrashResult }
  | { intent: 'delete-trash-batch' | 'empty-prism-trash'; result: { error?: string } };

/**
 * Puts back a batch of Prism's Trash, deletes one for good, or empties it, as `form` says, then
 * reads the Trash again. `null` for any other form.
 */
export async function prismTrashAction(
  library: LibrarySession,
  form: FormData,
): Promise<PrismTrashActionResult | null> {
  const batchId = String(form.get('batchId'));
  let data: PrismTrashActionResult;
  switch (form.get('intent')) {
    case 'put-back-trash-batch': {
      data = {
        intent: 'put-back-trash-batch',
        result: await library.trash.putBackTrashBatch(batchId),
      };
      break;
    }
    case 'delete-trash-batch': {
      data = {
        intent: 'delete-trash-batch',
        result: await library.trash.deleteTrashBatch(batchId),
      };
      break;
    }
    case 'empty-prism-trash': {
      data = { intent: 'empty-prism-trash', result: await library.trash.emptyPrismTrash() };
      break;
    }
    default: {
      return null;
    }
  }
  await prismTrashChanged(library);
  return data;
}

/** What a batch's run was of, as its line says: `≤ 2 stars in Photos/2019`. */
export function batchViewLabel({ view }: PrismTrashBatchInfo): string | null {
  if (!view) {
    return null;
  }
  const narrowed = narrowedBy(view);
  const folder = view.folder || 'the top of the share';
  return narrowed ? `${narrowed} in ${folder}` : folder;
}

/** When a batch's run began, as its line says. */
export function batchDateLabel({ trashedAt }: PrismTrashBatchInfo): string {
  return trashedAt === null
    ? 'Unknown batch'
    : new Date(trashedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** What putting back a batch did, in a sentence. */
export function putBackText(result: UndoTrashResult): string {
  if (result.restored === undefined) {
    return result.error;
  }
  const parts = [
    `Put back ${result.restored.toLocaleString()} ${result.restored === 1 ? 'item' : 'items'}`,
  ];
  if (result.renamed.length > 0) {
    parts.push(
      `${result.renamed.length.toLocaleString()} under new names, as their places were taken`,
    );
  }
  return result.error ? `${result.error} ${parts.join(' · ')}.` : parts.join(' · ');
}
