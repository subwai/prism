import { debug } from '@prism/shared';
import {
  type FetchQueryOptions,
  isCancelledError,
  QueryClient,
  type QueryKey,
} from '@tanstack/react-query';

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
        // A folder's contents can hold many thousands of entries, too many to compare on every
        // read.
        structuralSharing: false,
      },
    },
  });
  if (log.enabled) {
    logQueries(client);
  }
  return client;
}

/** Whether a query's `key` is of one of `kinds`, such as `'original'`, and about an ID in `ids`. */
export function isQueryAbout(key: readonly unknown[], kinds: string[], ids: Set<string>) {
  return kinds.includes(String(key[0])) && ids.has(String(key[1]));
}

/**
 * `client.fetchQuery(options)` for a read something waits on, such as a route's loader. A change
 * or refresh that invalidates the query meanwhile cancels the fetch under way and starts another,
 * and TanStack Query rejects whoever waited for the first with `CancelledError`, with no option to
 * follow the second; this waits for it instead. A read cancelled with none after it, as when the
 * session closes and clears its queries, still fails, so nothing reads for a closed session.
 */
export async function fetchLatest<Data, Key extends QueryKey>(
  client: QueryClient,
  options: FetchQueryOptions<Data, Error, Data, Key>,
): Promise<Data> {
  try {
    return await client.fetchQuery(options);
  } catch (error) {
    const replaced = client.getQueryState(options.queryKey)?.fetchStatus === 'fetching';
    if (!isCancelledError(error) || !replaced) {
      throw error;
    }
    return fetchLatest(client, options);
  }
}
