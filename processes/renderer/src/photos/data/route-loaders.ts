import type { ViewMode } from '#photos/data/entries';
import { requireLibrary } from '#photos/data/session';
import { sortOrder } from '#photos/data/urls';
import { redirect, type ShouldRevalidateFunctionArgs } from 'react-router';

export async function loadGallery({ request }: { request: Request }, mode: ViewMode) {
  const library = requireLibrary();
  const params = new URL(request.url).searchParams;
  const directoryId = params.get('folder') ?? library.root.id;
  const trail = library.trail(directoryId);
  if (!trail) {
    throw redirect(`/library/${mode}`);
  }
  const gallery = await library.openGallery(
    { directoryId, metadata: sortOrder(params) !== 'name', recursive: mode === 'filmstrip' },
    request.signal
  );
  return { ...gallery, trail };
}

export function revalidateGallery({
  currentUrl,
  nextUrl,
  defaultShouldRevalidate,
  actionResult
}: ShouldRevalidateFunctionArgs) {
  if (actionResult) {
    return Boolean(actionResult.refreshed);
  }
  const previous = currentUrl.searchParams,
    next = nextUrl.searchParams;
  return (
    currentUrl.pathname !== nextUrl.pathname ||
    previous.get('folder') !== next.get('folder') ||
    (sortOrder(previous) === 'name') !== (sortOrder(next) === 'name') ||
    (currentUrl.href === nextUrl.href && defaultShouldRevalidate)
  );
}
