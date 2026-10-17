import type { Cached } from '#photos/data/stale';
import { type ReactNode, Suspense, use } from 'react';

// Settled requests are marked fulfilled, so `use()` returns fresh values without suspending.
function Read<Value>({
  read,
  children
}: {
  read: () => Promise<Value>;
  children: (value: Value) => ReactNode;
}) {
  return children(use(read()));
}

/**
 * Renders a library resource: fresh values paint at once, otherwise the shared request
 * suspends with the previous value (or `undefined` while loading) as the fallback.
 */
export function CachedValue<Value>({
  cached,
  read,
  generation,
  children
}: {
  cached: Cached<Value> | null;
  read: () => Promise<Value>;
  /**
   * A refresh, or a change to what it shows, gets a new boundary, so revealed content is not
   * held behind fresh requests.
   */
  generation: number | string;
  children: (value: Value | undefined) => ReactNode;
}) {
  // Always the same tree: switching to a bare `children()` once the value turns fresh would
  // remount what the boundary revealed, recreating every image it shows.
  return (
    <Suspense key={generation} fallback={children(cached?.value)}>
      <Read read={read}>{children}</Read>
    </Suspense>
  );
}
