import { requireLibrary } from '#photos/data/session';
import type { Route } from '#types/routes/resources+/+types/scan';

export function clientLoader({ request }: Route.ClientLoaderArgs) {
  const key = new URL(request.url).searchParams.get('key') ?? '';
  return requireLibrary().next(key, request.signal);
}
