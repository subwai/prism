import { arrangeEntries, screenful, type ViewMode } from '#photos/data/entries';
import { loadLibrary } from '#photos/data/session';
import { sortOrder } from '#photos/data/urls';
import { replace, type ShouldRevalidateFunctionArgs } from 'react-router';

export async function loadGallery({ request }: { request: Request }, mode: ViewMode) {
  const library = await loadLibrary();
  const params = new URL(request.url).searchParams;
  const directoryId = params.get('folder') ?? library.root.id;
  const trail = library.trail(directoryId);
  if (!trail) {
    // A folder from another library, say after going back past opening this one.
    throw replace(`/library/${mode}`);
  }
  const scan = await library.openGallery(
    { directoryId, metadata: sortOrder(params) !== 'name', recursive: mode === 'filmstrip' },
    request.signal
  );
  // The navigation commits, and crossfades, when the loader returns; until then the current
  // view stays. Waiting for the thumbnails it opens with means it fades to them, not to
  // empty tiles that fill in a moment later.
  const opening = arrangeEntries(
    scan.getSnapshot().entries,
    params.get('q') ?? '',
    sortOrder(params),
    params.get('order') === 'desc',
    mode === 'filmstrip'
  ).slice(0, screenful(mode));
  await library.preload(opening, request.signal);
  return { scan, trail };
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
