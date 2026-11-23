import { rateEntry, ratingOf } from '#data/edits/ratings';
import type { LibrarySession } from '#data/library';
import { prismTrashAction, refreshPrismTrash } from '#data/trash/prism-trash';
import { trashRunsOf } from '#data/trash/runs';
import type { TrashChoices, TrashDestination } from '@prism/shared';

/** The intents of the library's action that need only the session, which shows what they do. */
const INTENTS = new Set([
  'delete-trash-batch',
  'empty-prism-trash',
  'put-back-trash-batch',
  'rate',
  'trash',
  'undo-trash',
]);

/** Whether the library's action takes `intent` to the session alone, so nothing reads again. */
export function isSessionIntent(intent: unknown) {
  return INTENTS.has(String(intent));
}

/**
 * Carries out a form of the library's action that needs only `library`: rating an entry,
 * moving a view's plan to the Trash and undoing it, or putting back, deleting or emptying what
 * is in Prism's Trash. `null` for any other.
 */
export async function sessionAction(library: LibrarySession, form: FormData) {
  switch (form.get('intent')) {
    case 'rate': {
      // The session shows the rating wherever the entry is on screen.
      return rateEntry(library, String(form.get('entryId')), ratingOf(form.get('rating')));
    }
    case 'trash': {
      const choices = JSON.parse(String(form.get('choices'))) as TrashChoices;
      const result = await trashRunsOf(library).run({
        choices,
        destination: String(form.get('destination')) as TrashDestination,
        entries: Number(form.get('entries')),
        version: Number(form.get('version')),
        viewId: String(form.get('viewId')),
      });
      await refreshPrismTrash(library);
      return result;
    }
    case 'undo-trash': {
      const result = await trashRunsOf(library).undo(String(form.get('runId')));
      await refreshPrismTrash(library);
      return result;
    }
    default: {
      return prismTrashAction(library, form);
    }
  }
}
