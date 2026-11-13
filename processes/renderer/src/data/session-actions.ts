import type { LibrarySession } from '#data/library';
import { prismTrashAction, prismTrashChanged } from '#data/prism-trash';
import { rateEntry, ratingOf } from '#data/ratings';
import { trashRunsOf } from '#data/trash-runs';
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
  const intent = form.get('intent');
  if (intent === 'rate') {
    // The session shows the rating wherever the entry is on screen.
    const result = await rateEntry(
      library,
      String(form.get('entryId')),
      ratingOf(form.get('rating')),
    );
    return 'error' in result ? result : { rated: result.entry };
  }
  if (intent === 'trash') {
    const choices = JSON.parse(String(form.get('choices'))) as TrashChoices;
    const result = await trashRunsOf(library).run(
      String(form.get('viewId')),
      Number(form.get('version')),
      choices,
      String(form.get('destination')) as TrashDestination,
      Number(form.get('items')),
    );
    await prismTrashChanged(library);
    return result;
  }
  if (intent === 'undo-trash') {
    const result = await trashRunsOf(library).undo(String(form.get('runId')));
    await prismTrashChanged(library);
    return result;
  }
  return prismTrashAction(library, form);
}
