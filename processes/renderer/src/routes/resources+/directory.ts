import { arrangeEntries } from '#photos/data/entries';
import { requireLibrary } from '#photos/data/session';
import type { Route } from '#types/routes/resources+/+types/directory';

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const id = new URL(request.url).searchParams.get('id') ?? '';
  const state = await requireLibrary().readDirectory(id, request.signal);
  return {
    folders: arrangeEntries(
      state.entries.filter((entry) => entry.kind === 'directory'),
      '',
      'name',
      false
    ),
    id,
    state
  };
}
