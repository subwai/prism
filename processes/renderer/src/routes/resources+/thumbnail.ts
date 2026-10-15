import { requireLibrary } from '#photos/data/session';
import type { Route } from '#types/routes/resources+/+types/thumbnail';
import type { ThumbnailResult } from '@app/shared';

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const id = new URL(request.url).searchParams.get('id') ?? '';
  const result = await requireLibrary()
    .thumbnail(id, request.signal)
    .catch(
      (error: unknown) =>
        ({
          message: String(error),
          status: 'failed'
        }) satisfies ThumbnailResult
    );
  return { id, result };
}
