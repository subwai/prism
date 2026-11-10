import { debug } from '@prism/shared';
import { type Query, QueryClient } from '@tanstack/react-query';

const log = debug('renderer:queries');

/** Logs each query's reads and what ends them, when `DEBUG` asks for it. */
function logQueries(client: QueryClient) {
  client.getQueryCache().subscribe((event) => {
    if (event.type === 'updated' && event.action.type !== 'setState') {
      log('%o %s', event.query.queryKey, event.action.type);
    } else if (event.type === 'removed') {
      log('%o removed', event.query.queryKey);
    }
  });
}

/** The cache of what a folder's session has read, for the views inside it. */
export function createQueryClient() {
  const client = new QueryClient({
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
        structuralSharing: false,
      },
    },
  });
  if (log.enabled) {
    logQueries(client);
  }
  return client;
}

/** Whether a query's `key` is one of `kinds`, such as thumbnails, about an ID in `ids`. */
export function about(key: readonly unknown[], kinds: string[], ids: Set<string>) {
  return kinds.includes(String(key[0])) && ids.has(String(key[1]));
}

/** Filters for every query but those of `kind`, which their owner reads again its own way. */
export function allBut(kind: string) {
  return { predicate: ({ queryKey }: Query) => queryKey[0] !== kind };
}
