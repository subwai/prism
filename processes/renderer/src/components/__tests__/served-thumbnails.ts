import type { cachedThumbnailURL } from '@prism/shared';

/**
 * The thumbnails `fakeFolder` has cached, by entry. The main process serves its cached ones at
 * `cachedThumbnailURL`, but the tests serve no `media:` URLs, so they fail to load and the window
 * asks for each to be made. Kept apart from `fakeFolder`, which imports `@prism/shared` itself,
 * so a mock of that can load this.
 */
export const cachedThumbnails = new Map<string, string>();

/**
 * `cachedThumbnailURL`, but the thumbnail itself for one `fakeFolder` has cached, for a file
 * that wants them on a view's first frame, as cached ones are in the app:
 *
 * ```ts
 * vi.mock(import('@prism/shared'), async (importOriginal) => {
 *   const shared = await importOriginal();
 *   const { servedThumbnailURL } = await import('#components/__tests__/served-thumbnails');
 *   return { ...shared, cachedThumbnailURL: servedThumbnailURL(shared.cachedThumbnailURL) };
 * });
 * ```
 */
export function servedThumbnailURL(cached: typeof cachedThumbnailURL): typeof cachedThumbnailURL {
  return (session, entry, generation) =>
    cachedThumbnails.get(entry.id) ?? cached(session, entry, generation);
}
