import type { buildCachedThumbnailURL } from '@prism/shared';

/**
 * The thumbnails `fakeFolder` has cached, by entry. The main process serves its cached ones at
 * `buildCachedThumbnailURL`, but the tests serve no `media:` URLs, so they fail to load and the window
 * asks for each to be made. Kept apart from `fakeFolder`, which imports `@prism/shared` itself,
 * so a mock of that can load this.
 */
export const cachedThumbnails = new Map<string, string>();

/**
 * `buildCachedThumbnailURL`, but the thumbnail itself for one `fakeFolder` has cached, for a file
 * that wants them on a view's first frame, as cached ones are in the app:
 *
 * ```ts
 * vi.mock(import('@prism/shared'), async (importOriginal) => {
 *   const shared = await importOriginal();
 *   const { servedThumbnailURL } = await import('#components/__tests__/served-thumbnails');
 *   return { ...shared, buildCachedThumbnailURL: servedThumbnailURL(shared.buildCachedThumbnailURL) };
 * });
 * ```
 */
export function servedThumbnailURL(
  cached: typeof buildCachedThumbnailURL,
): typeof buildCachedThumbnailURL {
  return (session, entry, generation) =>
    cachedThumbnails.get(entry.id) ?? cached(session, entry, generation);
}
