import type { Plugin } from 'vitest/config';

// Vitest keeps each module it has transformed in a cache on disk, `node_modules/.vitest-cache`,
// keyed by the module's own text. A module that uses `import.meta.glob` also depends on which
// files the glob finds, so a cached copy misses a file added since, such as a new migration:
// tests then fail with "no such table" until the cache is cleared. Vitest skips caching such
// modules, but it looks for `import.meta.glob(` and misses the typed form,
// `import.meta.glob<string>(`, which the catalog and the thumbnail index use.
const TYPED_GLOB = /import\.meta\.glob\s*</u;

/** Keeps modules that use the typed `import.meta.glob<…>(` out of Vitest's cache, as the untyped. */
export function uncachedGlobs(): Plugin {
  return {
    configureVitest({ defineCacheKeyGenerator }) {
      // `false` leaves the module out of the cache; `undefined` leaves the key as it is.
      defineCacheKeyGenerator(({ sourceCode }) =>
        TYPED_GLOB.test(sourceCode) ? false : undefined,
      );
    },
    name: 'prism:uncached-globs',
  };
}
