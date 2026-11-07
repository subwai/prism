import type { DirectoryScan } from '#data/directory-scan';
import { arrangeView, screenful, THUMBNAIL_SIZE, type ViewMode } from '#data/entries';
import { photoFilter } from '#data/filters';
import type { FolderTrail, PhotoLibrary } from '#data/library';
import { preload, preloadPages } from '#data/preload';
import { loadLibrary } from '#data/session';
import { scanDetail, sortOrder } from '#data/urls';
import type { ScanOptions } from '@prism/shared';
import { replace, type ShouldRevalidateFunctionArgs } from 'react-router';

/**
 * How long a navigation waits for its view before showing it loading. A folder read before, with
 * its thumbnails cached, is ready well within it and crossfades straight to its photos.
 */
const READY_MS = 100;

/**
 * Stops the view still reading its first page once it has committed, when the next one starts.
 * The router aborts only loaders that have not returned, and this one returns early.
 */
let stopReading: AbortController | null = null;

/** What a gallery view shows: its folder, and the scan of it as it reads. */
export interface GalleryData {
  scan: DirectoryScan;
  trail: FolderTrail;
}

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
  stopReading?.abort();
  const reading = new AbortController();
  stopReading = reading;
  const signal = AbortSignal.any([request.signal, reading.signal]);
  const gallery = openGallery(
    library,
    { directoryId, ...scanDetail(params), recursive: mode === 'filmstrip' },
    params,
    mode,
    signal,
  ).then(
    (scan): GalleryData => ({ scan, trail }),
    (error: unknown) => {
      // A view the next one replaced keeps loading until that one shows, rather than an error.
      if (reading.signal.aborted) {
        return new Promise<never>(() => {
          /* Never settles: the view goes as the next one shows. */
        });
      }
      throw error;
    },
  );
  // The navigation commits, and crossfades, when the loader returns. A view that is ready in
  // time fades in with its photos; one that is not fades to its loading state instead, which
  // `<Await>` shows until it is.
  const ready = await Promise.race([
    gallery,
    new Promise<null>((resolve) => {
      setTimeout(resolve, READY_MS, null);
    }),
  ]);
  return { gallery: ready ?? gallery, trail };
}

async function openGallery(
  library: PhotoLibrary,
  options: ScanOptions,
  params: URLSearchParams,
  mode: ViewMode,
  signal: AbortSignal,
) {
  const scan = await library.openGallery(options, signal);
  const arranged = arrangeView(scan.getSnapshot().entries, mode, {
    descending: params.get('order') === 'desc',
    filter: photoFilter(params),
    search: params.get('q') ?? '',
    sort: sortOrder(params),
  });
  // Waiting for the thumbnails it opens with means the view fades to them, not to empty tiles
  // that fill in a moment later. The reader opens on its first pages instead, and the
  // filmstrip on its first photo above them.
  if (mode === 'reader') {
    await preloadPages(library, arranged.slice(0, 2));
    return scan;
  }
  const tiles = arranged.slice(0, screenful(THUMBNAIL_SIZE[mode], { rows: mode === 'grid' }));
  await Promise.all([
    preload(library, tiles, signal),
    mode === 'filmstrip' && preloadPages(library, arranged.slice(0, 1)),
  ]);
  return scan;
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
