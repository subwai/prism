import { QueryValue } from '#components/query-value';
import { Banner, Button, ListRow, LoadingState, PreviewSheet } from '@prism/design-system';
import type { ReadError, ViewState } from '@prism/shared';
import { type QueryKey, useQueryClient, type UseSuspenseQueryOptions } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { FileWarning } from 'lucide-react';
import { useRef, useState } from 'react';

/** A row with a one-line message; longer ones are measured as they show. */
const ROW_HEIGHT = 52;

/** Every item a scan could not read, and why, as many as there are. */
function ProblemList({ errors }: { errors: ReadError[] }) {
  // TanStack Virtual's virtualizer changes in place, so React Compiler would keep showing
  // the rows it first rendered.
  'use no memo';
  const container = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: errors.length,
    estimateSize: () => ROW_HEIGHT,
    getScrollElement: () => container.current,
    overscan: 8,
  });
  return (
    <div ref={container} className="min-h-0 flex-1 overflow-y-auto">
      <ul className="relative" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((row) => {
          const error = errors[row.index];
          return (
            error && (
              <ListRow
                key={row.key}
                data-index={row.index}
                ref={virtualizer.measureElement}
                className="absolute inset-x-0 top-0"
                style={{ transform: `translateY(${row.start}px)` }}
                icon={<FileWarning className="text-warning" />}
                title={error.path === '.' ? 'This folder' : error.path}
              >
                {error.message}
              </ListRow>
            )
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Problems reading the folder, above its contents: the scan's failure, or how many items could
 * not be read, which opens a list of them, read from `errors` only then, as there can be many.
 * Dismissed until the next scan, which `scanKey` tells.
 */
export function ScanProblems<Key extends QueryKey>({
  scan,
  scanKey,
  errors,
  onRetry,
}: {
  scan: Pick<ViewState, 'error' | 'errorCount'>;
  scanKey: object;
  errors: UseSuspenseQueryOptions<ReadError[], Error, ReadError[], Key>;
  onRetry: () => void;
}) {
  const queries = useQueryClient();
  // The scan dismissed, rather than a flag, so a new scan shows its problems again.
  const [dismissed, setDismissed] = useState<object | null>(null);
  const [listing, setListing] = useState(false);
  const { errorCount } = scan;
  if ((!scan.error && errorCount === 0) || dismissed === scanKey) {
    return null;
  }
  const count = `${errorCount.toLocaleString()} ${errorCount === 1 ? 'item' : 'items'}`;
  return (
    <>
      <Banner
        action={
          <>
            {!scan.error && <Button onClick={() => setListing(true)}>Show details</Button>}
            <Button onClick={onRetry}>Try again</Button>
          </>
        }
        onDismiss={() => setDismissed(scanKey)}
      >
        {scan.error ?? `${count} could not be read. The rest are shown below.`}
      </Banner>
      {listing && (
        <PreviewSheet
          title="Could not be read"
          caption={count}
          size="medium"
          actions={
            <Button
              onClick={() => {
                queries
                  .fetchQuery(errors)
                  .then((read) =>
                    navigator.clipboard.writeText(
                      read.map((error) => `${error.path}: ${error.message}`).join('\n'),
                    ),
                  )
                  .catch(() => null);
              }}
            >
              Copy all
            </Button>
          }
          onClose={() => setListing(false)}
        >
          <QueryValue query={errors}>
            {(read) => (read ? <ProblemList errors={read} /> : <LoadingState label="Reading…" />)}
          </QueryValue>
        </PreviewSheet>
      )}
    </>
  );
}
