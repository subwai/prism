import { requireLibrary } from '#photos/data/session';
import type { Route } from '#types/routes/resources+/+types/original';

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const id = new URL(request.url).searchParams.get('id') ?? '';
  const url = await requireLibrary()
    .api.getOriginalURL(id)
    .catch(() => null);
  return { id, url };
}
