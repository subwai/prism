import { screenful, THUMBNAIL_SIZE, type ViewMode } from '#data/entries';
import type { LibrarySession } from '#data/library';
import { preload, preloadPages } from '#data/media/preload';
import { loadLibrary } from '#data/session';
import type { FolderTrail } from '#data/tree/trails';
import { viewSpec } from '#data/urls';
import type { GalleryView } from '#data/views/gallery-view';
import { rememberView } from '#data/views/last-view';
import { needsConversion, type ViewSpec } from '@prism/shared';
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

/** What a gallery view shows: its folder, and the worker's view of it. */
export interface GalleryData {
  view: GalleryView;
  trail: FolderTrail;
}

/**
 * The gallery's loader. It waits briefly for the view to be ready, so a folder read before
 * crossfades straight to its photos, and otherwise returns the view still loading.
 */
export async function loadGallery({ request }: { request: Request }, mode: ViewMode) {
  const library = await loadLibrary();
  const params = new URL(request.url).searchParams;
  // The catalog's folders, which the library layout's loader reads beside this one, once.
  await library.tree.readOnce();
  const trail = findTrailOrRedirect(library, mode, params);
  const directoryId = trail.at(-1)?.id ?? library.root.id;
  // Saved here, as the navigation commits, because that is when the view changes. Nothing else
  // would save it.
  rememberView({ directoryId, library, mode, params });
  const gallery = openLatestGallery({
    library,
    mode,
    signal: request.signal,
    spec: viewSpec(params, mode, directoryId),
  }).then((view): GalleryData => ({ trail, view }));
  // The navigation commits, and crossfades, when the loader returns. A view that is ready in
  // time fades in with its photos; one that is not fades to its loading state instead, which
  // `<Await>` shows until it is.
  const ready = await readyInTime(gallery);
  return { gallery: ready ?? gallery, trail };
}

/**
 * The folders down to the one the URL names. Throws a redirect when the URL names a folder the
 * library doesn't know, or one renamed in this window.
 */
function findTrailOrRedirect(library: LibrarySession, mode: ViewMode, params: URLSearchParams) {
  const directoryId = params.get('folder') ?? library.root.id;
  const trail = library.trail(directoryId);
  if (!trail) {
    // A folder of another library, say after going back past opening this one, or a folder that
    // is gone since it was last shown. The view goes to the top instead, sorted as it was.
    const top = new URLSearchParams(params);
    top.delete('folder');
    throw replace(`/library/${mode}?${top}`);
  }
  const shown = trail.at(-1)?.id ?? library.root.id;
  if (shown !== directoryId) {
    // A folder renamed in this window, or one inside it. The view goes to its new name.
    const renamed = new URLSearchParams(params);
    renamed.set('folder', shown);
    throw replace(`/library/${mode}?${renamed}`);
  }
  return trail;
}

/** The gallery to open, and the navigation's signal. */
interface GalleryRequest {
  library: LibrarySession;
  spec: ViewSpec;
  mode: ViewMode;
  signal: AbortSignal;
}

/**
 * Opens the gallery, first stopping the one opened before if it is still reading its first page.
 * A gallery that the next one replaced never settles, so it keeps loading until the next one
 * shows rather than showing an error.
 */
function openLatestGallery({ library, spec, mode, signal }: GalleryRequest) {
  stopReading?.abort();
  const reading = new AbortController();
  stopReading = reading;
  const opening = openGallery({
    library,
    mode,
    signal: AbortSignal.any([signal, reading.signal]),
    spec,
  });
  return opening.catch((error: unknown) => {
    if (reading.signal.aborted) {
      return new Promise<never>(() => {
        /* Never settles: the view goes as the next one shows. */
      });
    }
    throw error;
  });
}

/** `gallery` if it is ready within `READY_MS`, or else `null`. */
function readyInTime(gallery: Promise<GalleryData>) {
  return Promise.race([
    gallery,
    new Promise<null>((resolve) => {
      setTimeout(resolve, READY_MS, null);
    }),
  ]);
}

async function openGallery({ library, spec, mode, signal }: GalleryRequest) {
  const view = await library.openGallery(spec);
  signal.throwIfAborted();
  // Waiting for the cached thumbnails it opens with means the view fades to them, not to empty
  // tiles that fill in a moment later. The reader opens on its first pages instead, and the
  // filmstrip on its first photo above them, unless it is HEIF or TIFF: that is converted first,
  // which takes longer than a view should wait, so the viewer shows its thumbnail until then.
  if (mode === 'reader') {
    await preloadPages(library, await view.entries(0, 2));
    return view;
  }
  const tiles = await view.entries(0, screenful(THUMBNAIL_SIZE[mode], { rows: mode === 'grid' }));
  await Promise.all([
    preload(library, tiles),
    mode === 'filmstrip' &&
      preloadPages(
        library,
        tiles.slice(0, 1).filter((tile) => !needsConversion(tile.name)),
      ),
  ]);
  return view;
}

/**
 * What the URL has the gallery show, as text to compare. Opening a preview or a slideshow
 * changes nothing in it.
 */
function galleryContentsOf({ pathname, searchParams }: URL) {
  return JSON.stringify([
    pathname,
    viewSpec(searchParams, 'grid', searchParams.get('folder') ?? ''),
  ]);
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
  return (
    galleryContentsOf(currentUrl) !== galleryContentsOf(nextUrl) ||
    (currentUrl.href === nextUrl.href && defaultShouldRevalidate)
  );
}
