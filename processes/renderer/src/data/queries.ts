import { QueryClient } from '@tanstack/react-query';

/** The cache of what a folder's session has read, for the views inside it. */
export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Every read is local, so being offline must not pause it.
        networkMode: 'always',
        refetchOnReconnect: false,
        refetchOnWindowFocus: false,
        // Failures come back as values describing them, which trying again would not change.
        retry: false,
        // Data stays current until a change on disk or a refresh says otherwise.
        staleTime: Infinity,
        // Listings can hold many thousands of entries, too many to compare on every read.
        structuralSharing: false
      }
    }
  });
}

/** Whether a query's `key` is one of `kinds`, such as thumbnails, about an ID in `ids`. */
export function about(key: readonly unknown[], kinds: string[], ids: Set<string>) {
  return kinds.includes(String(key[0])) && ids.has(String(key[1]));
}
