import { arrangeView, screenful, THUMBNAIL_SIZE, type ViewMode } from '#data/entries';
import { preload, preloadPages } from '#data/preload';
import { loadLibrary } from '#data/session';
import { scanDetail, sortOrder } from '#data/urls';
import { replace, type ShouldRevalidateFunctionArgs } from 'react-router';

export async function loadGallery({ request }: { request: Request }, mode: ViewMode) {
  const library = await loadLibrary();
  const params = new URL(request.url).searchParams;
  const directoryId = params.get('folder') ?? library.root.id;
  const trail = library.trail(directoryId);
  if (!trail) {
    // A folder renamed in this window, which keeps the view open under its new name.
    const moved = library.follow(directoryId);
    if (moved !== directoryId && library.trail(moved)) {
      params.set('folder', moved);
      throw replace(`/library/${mode}?${params}`);
    }
    // A folder from another library, say after going back past opening this one.
    throw replace(`/library/${mode}`);
  }
  const scan = await library.openGallery(
    { directoryId, ...scanDetail(params), recursive: mode === 'filmstrip' },
    request.signal,
  );
  const arranged = arrangeView(scan.getSnapshot().entries, mode, {
    descending: params.get('order') === 'desc',
    search: params.get('q') ?? '',
    sort: sortOrder(params),
  });
  // The navigation commits, and crossfades, when the loader returns; until then the current
  // view stays. Waiting for the thumbnails it opens with means it fades to them, not to
  // empty tiles that fill in a moment later. The reader opens on its first pages instead.
  await (mode === 'reader'
    ? preloadPages(library, arranged.slice(0, 2))
    : preload(
        library,
        arranged.slice(0, screenful(THUMBNAIL_SIZE[mode], { rows: mode === 'grid' })),
        request.signal,
      ));
  return { scan, trail };
}

export function revalidateGallery({
  currentUrl,
  nextUrl,
  defaultShouldRevalidate,
  actionResult,
}: ShouldRevalidateFunctionArgs) {
  if (actionResult) {
    return Boolean(actionResult.refreshed);
  }
  const previous = currentUrl.searchParams,
    next = nextUrl.searchParams;
  return (
    currentUrl.pathname !== nextUrl.pathname ||
    previous.get('folder') !== next.get('folder') ||
    JSON.stringify(scanDetail(previous)) !== JSON.stringify(scanDetail(next)) ||
    (currentUrl.href === nextUrl.href && defaultShouldRevalidate)
  );
}
