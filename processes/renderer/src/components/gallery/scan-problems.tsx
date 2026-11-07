import type { ScanState } from '#data/directory-scan';
import { Banner, Button, PreviewSheet } from '@prism/design-system';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useRef, useState } from 'react';

type ScanError = ScanState['errors'][number];

/** A row with a one-line message; longer ones are measured as they show. */
const ROW_HEIGHT = 52;

/** Every item a scan could not read, and why, as many as there are. */
function ProblemList({ errors }: { errors: ScanError[] }) {
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
              <li
                key={row.key}
                data-index={row.index}
                ref={virtualizer.measureElement}
                className="border-separator absolute inset-x-0 top-0 flex flex-col gap-0.5 border-b px-5 py-2.5"
                style={{ transform: `translateY(${row.start}px)` }}
              >
                <span className="truncate font-medium select-text" title={error.path}>
                  {error.path === '.' ? 'This folder' : error.path}
                </span>
                <span className="text-label-secondary text-sm break-words select-text">
                  {error.message}
                </span>
              </li>
            )
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Problems reading the folder, above its contents: the scan's failure, or how many items could
 * not be read, which opens a list of them. Dismissed until the next scan, which `scanKey` tells.
 */
export function ScanProblems({
  scan,
  scanKey,
  onRetry,
}: {
  scan: ScanState;
  scanKey: object;
  onRetry: () => void;
}) {
  // The scan dismissed, rather than a flag, so a new scan shows its problems again.
  const [dismissed, setDismissed] = useState<object | null>(null);
  const [listing, setListing] = useState(false);
  const { errors } = scan;
  if ((!scan.error && errors.length === 0) || dismissed === scanKey) {
    return null;
  }
  const count = `${errors.length.toLocaleString()} ${errors.length === 1 ? 'item' : 'items'}`;
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
              onClick={() =>
                navigator.clipboard.writeText(
                  errors.map((error) => `${error.path}: ${error.message}`).join('\n'),
                )
              }
            >
              Copy all
            </Button>
          }
          onClose={() => setListing(false)}
        >
          <ProblemList errors={errors} />
        </PreviewSheet>
      )}
    </>
  );
}
