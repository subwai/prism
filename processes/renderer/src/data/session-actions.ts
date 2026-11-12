import type { LibrarySession } from '#data/library';
import { rateEntry, ratingOf } from '#data/ratings';
import { trashRunsOf } from '#data/trash-runs';
import type { TrashChoices } from '@prism/shared';

/** The intents of the library's action that need only the session, which shows what they do. */
const INTENTS = new Set(['rate', 'trash', 'undo-trash']);

/** Whether the library's action takes `intent` to the session alone, so nothing reads again. */
export function isSessionIntent(intent: unknown) {
  return INTENTS.has(String(intent));
}

/**
 * Carries out a form of the library's action that needs only `library`: rating an entry, or
 * moving a view's plan to the Trash and undoing it. `null` for any other.
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
    return trashRunsOf(library).run(
      String(form.get('viewId')),
      Number(form.get('version')),
      choices,
      Number(form.get('items')),
    );
  }
  if (intent === 'undo-trash') {
    return trashRunsOf(library).undo(String(form.get('runId')));
  }
  return null;
}
