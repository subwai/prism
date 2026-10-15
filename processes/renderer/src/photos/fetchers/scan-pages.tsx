import type { DirectoryScan, ScanState } from '#photos/data/directory-scan';
import { resourceURL } from '#photos/data/urls';
import type { clientLoader } from '#routes/resources+/scan';
import { type ReactNode, useEffect } from 'react';
import { useFetcher } from 'react-router';

/** Fetch the next page only after the router has committed the previous page. */
export function ScanResults({
  scan,
  initial,
  children
}: {
  scan: DirectoryScan;
  initial: ScanState;
  children: (state: ScanState) => ReactNode;
}) {
  const fetcher = useFetcher<typeof clientLoader>();
  const state = fetcher.data?.key === scan.key ? fetcher.data.state : initial;
  const { reset } = fetcher;
  useEffect(
    () => () => {
      reset();
      scan.close();
    },
    [reset, scan]
  );
  useEffect(() => {
    if (state.loading && fetcher.state === 'idle') {
      fetcher.load(resourceURL('scan', { key: scan.key }));
    }
  }, [scan.key, state, fetcher]);
  return children(state);
}
