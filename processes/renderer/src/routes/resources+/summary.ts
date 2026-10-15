import { requireLibrary } from '#photos/data/session';
import type { Route } from '#types/routes/resources+/+types/summary';

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const id = new URL(request.url).searchParams.get('id') ?? '';
  const summary = await requireLibrary()
    .inspect(id, request.signal)
    .catch(() => null);
  return { id, summary };
}
